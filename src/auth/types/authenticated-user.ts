import type { PermissionCode } from '../../rbac/constants/permissions';
import type { UserStatus } from '../../users/entities/user.entity';

/**
 * What the JWT guard puts on `req.user`: a snapshot resolved from the database
 * on each request (cached briefly), never decoded from the token.
 *
 * The access token carries no authorization data at all — only `sub`, `jti` and
 * the standard registered claims. That is what lets a revoked role or a
 * suspended account take effect without waiting for the token to expire.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: UserStatus;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionCode[];
  /**
   * The access token's `jti`, identifying this session.
   *
   * Absent when the snapshot came from somewhere other than a bearer token.
   */
  readonly tokenId?: string;
}

/** Claims carried by an access token. Deliberately minimal. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id, so a specific session can be logged out. */
  jti: string;
  /** Guards against a refresh token being presented as an access token. */
  typ: 'access';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}
