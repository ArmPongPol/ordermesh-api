import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  invalidToken,
  tokenExpired,
  tokenReuseDetected,
} from '../common/exceptions/app.exception';
import {
  REFRESH_TOKEN_SECRET_BYTES,
  TOKEN_HASH_OPTIONS,
} from './auth.constants';
import { RefreshToken, RevokedReason } from './entities/refresh-token.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedRefreshToken {
  /** The compound `<id>.<secret>` value handed to the client. Never stored. */
  token: string;
  familyId: string;
  expiresAt: Date;
}

export interface RequestFingerprint {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Why rotation reports reuse instead of throwing it: the revocation has to
 * outlive the transaction, and an exception inside one rolls its writes back.
 */
type RotateOutcome =
  | {
      kind: 'rotated';
      issued: IssuedRefreshToken & { id: string };
      userId: string;
    }
  | { kind: 'reuse'; familyId: string; userId: string };

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlDays: number;
  private readonly absoluteTtlDays: number;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.ttlDays = config.getOrThrow<number>('auth.refreshTtlDays');
    this.absoluteTtlDays = config.getOrThrow<number>(
      'auth.refreshAbsoluteTtlDays',
    );
  }

  /** Starts a new family. Called on login and registration, never on refresh. */
  async issue(
    userId: string,
    fingerprint: RequestFingerprint = {},
  ): Promise<IssuedRefreshToken> {
    const now = Date.now();
    return this.insert({
      userId,
      familyId: randomUUID(),
      expiresAt: new Date(now + this.ttlDays * DAY_MS),
      familyExpiresAt: new Date(now + this.absoluteTtlDays * DAY_MS),
      fingerprint,
    });
  }

  /**
   * Validate a presented token and replace it with a new one in the same family.
   *
   * Runs in a single transaction with `SELECT ... FOR UPDATE` on the row, so two
   * concurrent refreshes of the same token cannot both succeed — without the
   * lock, both would read it as live and the loser's rotation would look
   * exactly like a replay.
   */
  async rotate(
    presented: string,
    fingerprint: RequestFingerprint = {},
  ): Promise<{ issued: IssuedRefreshToken; userId: string }> {
    const parsed = RefreshTokenService.parse(presented);
    if (!parsed) {
      throw invalidToken('Malformed refresh token');
    }

    const outcome = await this.dataSource.transaction<RotateOutcome>(
      async (manager) => {
        const repo = manager.getRepository(RefreshToken);

        const row = await repo
          .createQueryBuilder('t')
          .setLock('pessimistic_write')
          .where('t.id = :id', { id: parsed.id })
          .getOne();

        if (!row) {
          throw invalidToken('Refresh token not recognised');
        }

        const secretMatches = await RefreshTokenService.verifySecret(
          row.tokenHash,
          parsed.secret,
        );

        // A valid id with a wrong secret is noise — a guessed or truncated token.
        // Deliberately NOT treated as reuse: revoking the family here would hand
        // an attacker a cheap way to log out anyone whose token id they can guess.
        if (!secretMatches) {
          throw invalidToken('Refresh token not recognised');
        }

        // The secret was correct AND the token was already retired. Only the
        // legitimate holder or a thief can be here, and we cannot tell which —
        // so we end the family and force both to re-authenticate.
        //
        // Reported rather than thrown: throwing here would roll the transaction
        // back and undo the very revocation we need to persist, leaving a
        // detected theft with the family still live.
        if (row.revokedAt) {
          return {
            kind: 'reuse',
            familyId: row.familyId,
            userId: row.userId,
          };
        }

        const now = Date.now();
        if (row.expiresAt.getTime() <= now) {
          throw tokenExpired('Refresh token has expired');
        }
        if (row.familyExpiresAt.getTime() <= now) {
          throw tokenExpired('Session has reached its maximum lifetime');
        }

        // The sliding window may never outrun the family's absolute cap, which is
        // also enforced by refresh_tokens_expiry_order_check.
        const slidingExpiry = now + this.ttlDays * DAY_MS;
        const issued = await this.insert({
          userId: row.userId,
          familyId: row.familyId,
          expiresAt: new Date(
            Math.min(slidingExpiry, row.familyExpiresAt.getTime()),
          ),
          familyExpiresAt: row.familyExpiresAt,
          fingerprint,
          manager: repo,
        });

        await repo.update(row.id, {
          revokedAt: new Date(),
          revokedReason: 'ROTATED',
          replacedByTokenId: issued.id,
        });

        return { kind: 'rotated', issued, userId: row.userId };
      },
    );

    if (outcome.kind === 'reuse') {
      // Outside the transaction, so the revocation commits on its own.
      await this.tokens.update(
        { familyId: outcome.familyId, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      );
      this.logger.warn(
        `Refresh token reuse detected for user=${outcome.userId} family=${outcome.familyId}; family revoked`,
      );
      throw tokenReuseDetected();
    }

    return { issued: outcome.issued, userId: outcome.userId };
  }

  /** Revokes one presented token. Used by logout; never throws on an unknown token. */
  async revoke(presented: string, reason: RevokedReason): Promise<boolean> {
    const parsed = RefreshTokenService.parse(presented);
    if (!parsed) {
      return false;
    }

    const row = await this.tokens.findOne({ where: { id: parsed.id } });
    if (
      !row ||
      row.revokedAt ||
      !(await RefreshTokenService.verifySecret(row.tokenHash, parsed.secret))
    ) {
      return false;
    }

    await this.tokens.update(row.id, {
      revokedAt: new Date(),
      revokedReason: reason,
    });
    return true;
  }

  /** Revokes every live session for a user. Returns how many were ended. */
  async revokeAllForUser(
    userId: string,
    reason: RevokedReason,
  ): Promise<number> {
    const result = await this.tokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
    return result.affected ?? 0;
  }

  private async insert(input: {
    userId: string;
    familyId: string;
    expiresAt: Date;
    familyExpiresAt: Date;
    fingerprint: RequestFingerprint;
    manager?: Repository<RefreshToken>;
  }): Promise<IssuedRefreshToken & { id: string }> {
    const repo = input.manager ?? this.tokens;
    const secret = randomBytes(REFRESH_TOKEN_SECRET_BYTES).toString(
      'base64url',
    );

    const row = repo.create({
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: await argon2.hash(secret, TOKEN_HASH_OPTIONS),
      expiresAt: input.expiresAt,
      familyExpiresAt: input.familyExpiresAt,
      userAgent: input.fingerprint.userAgent?.slice(0, 255) ?? null,
      ip: input.fingerprint.ip?.slice(0, 45) ?? null,
    });

    const saved = await repo.save(row);

    return {
      id: saved.id,
      // The only moment the plaintext exists. Only its argon2 hash was stored.
      token: `${saved.id}.${secret}`,
      familyId: saved.familyId,
      expiresAt: saved.expiresAt,
    };
  }

  /**
   * argon2 hashes are salted and therefore not searchable, so the token carries
   * its own row id: `<uuid>.<base64url secret>`. Splitting on the first dot
   * turns an impossible `WHERE token_hash = ?` into a primary-key lookup.
   */
  private static parse(
    presented: string,
  ): { id: string; secret: string } | null {
    const separator = presented.indexOf('.');
    if (separator <= 0 || separator === presented.length - 1) {
      return null;
    }

    const id = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);

    // Reject anything that is not a uuid before it reaches the database: a
    // malformed id would otherwise raise a Postgres cast error, i.e. a 500 on
    // attacker-controlled input.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );

    return isUuid ? { id, secret } : null;
  }

  private static async verifySecret(
    hash: string,
    secret: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      return false;
    }
  }
}
