import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PermissionCode } from '../rbac/constants/permissions';
import type { AuthenticatedUser } from './types/authenticated-user';
import type { UserStatus } from '../users/entities/user.entity';

interface SnapshotRow {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  roles: string[];
  permissions: PermissionCode[];
}

interface CacheEntry {
  snapshot: AuthenticatedUser;
  expiresAt: number;
}

/**
 * Resolves the identity + authorization snapshot the guards work from.
 *
 * Deliberately a per-request database lookup rather than claims baked into the
 * access token. Embedding them would make the guard pure CPU, but the token
 * would then be a snapshot frozen at login: revoking a role or suspending an
 * account would have no effect until it expired. With a 15-minute access TTL
 * that is a 15-minute window in which a just-removed operator still has their
 * old permissions — and it makes "an admin retunes a role" appear not to work.
 *
 * The cost is bounded instead: one query, and a short-lived memo in front of it.
 *
 * The cache is process-local, so the TTL is an upper bound on staleness across
 * instances. `invalidate()` is called by every mutation that can change the
 * answer, which makes a single-instance deployment exactly consistent rather
 * than eventually consistent. A Redis pub/sub bus is the documented upgrade
 * path for multi-instance; the call sites it needs already exist.
 */
@Injectable()
export class AuthContextService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>('auth.permissionCacheTtlMs') ?? 0;
  }

  async get(userId: string): Promise<AuthenticatedUser | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }

    const snapshot = await this.load(userId);

    if (snapshot && this.ttlMs > 0) {
      this.cache.set(userId, {
        snapshot,
        expiresAt: Date.now() + this.ttlMs,
      });
    }

    return snapshot;
  }

  /**
   * Drop a user's memo. MUST be called by anything that changes their roles,
   * their role's permissions, their status or their password — otherwise the
   * change is invisible for up to the TTL.
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Used when a role's permissions change, which affects everyone holding it. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * One query, no N+1: the joins fan out and `array_agg ... FILTER` collapses
   * them back. LEFT JOINs throughout so a user with no roles still returns a
   * row (with empty arrays) rather than vanishing.
   */
  private async load(userId: string): Promise<AuthenticatedUser | null> {
    // Typed through query's generic rather than an assertion, so the mapping
    // below is checked rather than reaching into `any`.
    const rows = await this.dataSource.query<SnapshotRow[]>(
      `SELECT u."id",
              u."email",
              u."full_name",
              u."status",
              COALESCE(array_agg(DISTINCT r."name") FILTER (WHERE r."name" IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p."code") FILTER (WHERE p."code" IS NOT NULL), '{}') AS permissions
         FROM "users" u
         LEFT JOIN "user_roles" ur       ON ur."user_id" = u."id"
         LEFT JOIN "roles" r             ON r."id" = ur."role_id"
         LEFT JOIN "role_permissions" rp ON rp."role_id" = r."id"
         LEFT JOIN "permissions" p       ON p."id" = rp."permission_id"
        WHERE u."id" = $1
        GROUP BY u."id"`,
      [userId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status,
      roles: row.roles,
      permissions: row.permissions,
    };
  }
}
