import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { AppHttpException } from '../common/exceptions/app.exception';
import { RefreshToken } from './entities/refresh-token.entity';
import { RefreshTokenService } from './refresh-token.service';

const USER = 'e6f1b0a2-0000-4000-8000-000000000001';

/**
 * In-memory stand-in for Repository<RefreshToken>, covering only the handful of
 * calls the service makes. Real argon2 hashing is left intact — the compound
 * token format and the hash/verify round trip are precisely what is under test.
 */
class FakeRepo {
  readonly rows = new Map<string, RefreshToken>();
  queries = 0;

  create(input: Partial<RefreshToken>): RefreshToken {
    return { ...input } as RefreshToken;
  }

  save(row: RefreshToken): Promise<RefreshToken> {
    row.id ??= randomUUID();
    row.createdAt ??= new Date();
    row.revokedAt ??= null;
    row.revokedReason ??= null;
    row.replacedByTokenId ??= null;
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findOne(options: { where: { id: string } }): Promise<RefreshToken | null> {
    this.queries += 1;
    return Promise.resolve(this.rows.get(options.where.id) ?? null);
  }

  update(
    criteria: string | Record<string, unknown>,
    patch: Partial<RefreshToken>,
  ): Promise<{ affected: number }> {
    const targets =
      typeof criteria === 'string'
        ? [this.rows.get(criteria)].filter(Boolean)
        : [...this.rows.values()].filter((row) => {
            if (criteria.familyId && row.familyId !== criteria.familyId) {
              return false;
            }
            if (criteria.userId && row.userId !== criteria.userId) {
              return false;
            }
            // Every object criteria the service uses pairs with IsNull().
            return 'revokedAt' in criteria ? row.revokedAt === null : true;
          });

    for (const row of targets as RefreshToken[]) {
      Object.assign(row, patch);
    }
    return Promise.resolve({ affected: targets.length });
  }

  createQueryBuilder() {
    let id = '';
    const builder = {
      setLock: () => builder,
      where: (_clause: string, params: { id: string }) => {
        id = params.id;
        return builder;
      },
      getOne: () => Promise.resolve(this.rows.get(id) ?? null),
    };
    return builder;
  }
}

function makeService(overrides: Record<string, number> = {}) {
  const repo = new FakeRepo();
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          'auth.refreshTtlDays': 30,
          'auth.refreshAbsoluteTtlDays': 90,
          ...overrides,
        })[key],
    ),
  } as unknown as ConfigService;

  const dataSource = {
    // Models rollback, not just the happy path. Without this a write made
    // inside the callback would survive a throw here but not in Postgres —
    // and that difference is exactly how a reuse-revocation can look correct
    // in tests while silently rolling back in production.
    transaction: async (
      cb: (m: { getRepository: () => FakeRepo }) => unknown,
    ) => {
      const snapshot = new Map(
        [...repo.rows].map(([id, row]) => [id, { ...row }]),
      );
      try {
        return await cb({ getRepository: () => repo });
      } catch (error) {
        repo.rows.clear();
        for (const [id, row] of snapshot) repo.rows.set(id, row);
        throw error;
      }
    },
  } as unknown as DataSource;

  const service = new RefreshTokenService(
    repo as unknown as Repository<RefreshToken>,
    dataSource,
    config,
  );

  return { service, repo };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as AppHttpException).code;
  }
  throw new Error('expected the call to reject');
}

describe('RefreshTokenService', () => {
  beforeAll(() => {
    // Reuse detection logs a warning by design; keep test output readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  describe('issue', () => {
    it('returns a compound <id>.<secret> token and stores only a hash', async () => {
      const { service, repo } = makeService();
      const issued = await service.issue(USER);

      const [id, secret] = issued.token.split('.');
      const stored = repo.rows.get(id)!;

      expect(stored).toBeDefined();
      expect(secret).toBeTruthy();
      // The plaintext secret must appear nowhere in the row.
      expect(stored.tokenHash).not.toBe(secret);
      expect(stored.tokenHash.startsWith('$argon2id$')).toBe(true);
      expect(JSON.stringify(stored)).not.toContain(secret);
    });

    it('starts a fresh family per login', async () => {
      const { service } = makeService();
      const [a, b] = [await service.issue(USER), await service.issue(USER)];

      expect(a.familyId).not.toBe(b.familyId);
    });

    it('records the caller fingerprint, truncated to the column width', async () => {
      const { service, repo } = makeService();
      const issued = await service.issue(USER, {
        userAgent: 'u'.repeat(400),
        ip: '203.0.113.7',
      });
      const stored = repo.rows.get(issued.token.split('.')[0])!;

      expect(stored.userAgent).toHaveLength(255);
      expect(stored.ip).toBe('203.0.113.7');
    });
  });

  describe('rotate', () => {
    it('issues a different token and retires the old one as ROTATED', async () => {
      const { service, repo } = makeService();
      const first = await service.issue(USER);

      const { issued, userId } = await service.rotate(first.token);
      const oldRow = repo.rows.get(first.token.split('.')[0])!;

      expect(userId).toBe(USER);
      expect(issued.token).not.toBe(first.token);
      expect(oldRow.revokedAt).toBeInstanceOf(Date);
      expect(oldRow.revokedReason).toBe('ROTATED');
      expect(oldRow.replacedByTokenId).toBe(issued.token.split('.')[0]);
    });

    it('keeps the replacement in the same family', async () => {
      const { service } = makeService();
      const first = await service.issue(USER);
      const { issued } = await service.rotate(first.token);

      expect(issued.familyId).toBe(first.familyId);
    });

    // The headline security property: a replayed token means the value leaked,
    // and we cannot tell the thief from the legitimate holder — so both lose.
    it('revokes the whole family when an already-rotated token is replayed', async () => {
      const { service, repo } = makeService();
      const first = await service.issue(USER);
      const { issued: second } = await service.rotate(first.token);

      expect(await codeOf(() => service.rotate(first.token))).toBe(
        ErrorCode.TOKEN_REUSE_DETECTED,
      );

      // Every token in the family is dead, including the one that was still live.
      const family = [...repo.rows.values()].filter(
        (r) => r.familyId === first.familyId,
      );
      expect(family).toHaveLength(2);
      expect(family.every((r) => r.revokedAt !== null)).toBe(true);
      expect(repo.rows.get(second.token.split('.')[0])!.revokedReason).toBe(
        'REUSE_DETECTED',
      );

      // And the replacement is now unusable too.
      expect(await codeOf(() => service.rotate(second.token))).toBe(
        ErrorCode.TOKEN_REUSE_DETECTED,
      );
    });

    // Revoking here would let anyone who can guess a token id log that session
    // out at will — a denial of service wearing a security control's clothes.
    it('does NOT revoke the family when only the secret is wrong', async () => {
      const { service, repo } = makeService();
      const first = await service.issue(USER);
      const [id] = first.token.split('.');

      expect(await codeOf(() => service.rotate(`${id}.wrong-secret`))).toBe(
        ErrorCode.INVALID_TOKEN,
      );
      expect(repo.rows.get(id)!.revokedAt).toBeNull();

      // The real token still works.
      await expect(service.rotate(first.token)).resolves.toBeDefined();
    });

    it('rejects a malformed token without touching the database', async () => {
      const { service, repo } = makeService();
      repo.queries = 0;

      for (const bad of ['', 'no-dot', '.secret', 'id.', 'not-a-uuid.secret']) {
        expect(await codeOf(() => service.rotate(bad))).toBe(
          ErrorCode.INVALID_TOKEN,
        );
      }
      // A non-uuid id must never reach Postgres, where the cast would 500 on
      // attacker-controlled input.
      expect(repo.queries).toBe(0);
    });

    it('rejects an unknown token id', async () => {
      const { service } = makeService();

      expect(await codeOf(() => service.rotate(`${randomUUID()}.secret`))).toBe(
        ErrorCode.INVALID_TOKEN,
      );
    });

    it('rejects an expired token as TOKEN_EXPIRED', async () => {
      const { service, repo } = makeService();
      const first = await service.issue(USER);
      repo.rows.get(first.token.split('.')[0])!.expiresAt = new Date(
        Date.now() - 1000,
      );

      expect(await codeOf(() => service.rotate(first.token))).toBe(
        ErrorCode.TOKEN_EXPIRED,
      );
    });

    it('stops rotating once the family reaches its absolute cap', async () => {
      const { service, repo } = makeService();
      const first = await service.issue(USER);
      const row = repo.rows.get(first.token.split('.')[0])!;
      // Still inside its own sliding window, but the family is over.
      row.familyExpiresAt = new Date(Date.now() - 1000);

      expect(await codeOf(() => service.rotate(first.token))).toBe(
        ErrorCode.TOKEN_EXPIRED,
      );
    });

    // Enforced by refresh_tokens_expiry_order_check too; this keeps the service
    // from ever producing a row the database would reject.
    it('never lets the sliding window outrun the family cap', async () => {
      // Family cap and sliding window are equal, so the cap always binds.
      const { service, repo } = makeService({
        'auth.refreshTtlDays': 30,
        'auth.refreshAbsoluteTtlDays': 30,
      });
      const first = await service.issue(USER);
      const { issued } = await service.rotate(first.token);
      const row = repo.rows.get(issued.token.split('.')[0])!;

      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(
        row.familyExpiresAt.getTime(),
      );
      expect(row.familyExpiresAt.getTime()).toBe(
        repo.rows.get(first.token.split('.')[0])!.familyExpiresAt.getTime(),
      );
    });
  });

  describe('revoke', () => {
    it('revokes a presented token with the given reason', async () => {
      const { service, repo } = makeService();
      const issued = await service.issue(USER);

      await expect(service.revoke(issued.token, 'LOGOUT')).resolves.toBe(true);
      expect(repo.rows.get(issued.token.split('.')[0])!.revokedReason).toBe(
        'LOGOUT',
      );
    });

    // Logout must be idempotent and must not become an oracle for valid ids.
    it('returns false for unknown, malformed or already-revoked tokens', async () => {
      const { service } = makeService();
      const issued = await service.issue(USER);
      await service.revoke(issued.token, 'LOGOUT');

      await expect(service.revoke(issued.token, 'LOGOUT')).resolves.toBe(false);
      await expect(service.revoke('garbage', 'LOGOUT')).resolves.toBe(false);
      await expect(
        service.revoke(`${randomUUID()}.secret`, 'LOGOUT'),
      ).resolves.toBe(false);
    });
  });

  describe('revokeAllForUser', () => {
    it('ends every live session and reports the count', async () => {
      const { service, repo } = makeService();
      await service.issue(USER);
      await service.issue(USER);
      const third = await service.issue(USER);
      await service.revoke(third.token, 'LOGOUT');

      // Only the two still-live sessions count.
      await expect(service.revokeAllForUser(USER, 'LOGOUT_ALL')).resolves.toBe(
        2,
      );
      expect([...repo.rows.values()].every((r) => r.revokedAt !== null)).toBe(
        true,
      );
      // The already-revoked one keeps its original reason.
      expect(repo.rows.get(third.token.split('.')[0])!.revokedReason).toBe(
        'LOGOUT',
      );
    });

    it('leaves other users alone', async () => {
      const { service, repo } = makeService();
      const other = 'e6f1b0a2-0000-4000-8000-000000000002';
      await service.issue(USER);
      const theirs = await service.issue(other);

      await service.revokeAllForUser(USER, 'USER_DISABLED');

      expect(repo.rows.get(theirs.token.split('.')[0])!.revokedAt).toBeNull();
    });
  });
});
