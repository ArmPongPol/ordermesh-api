import { registerAs } from '@nestjs/config';

/**
 * The literal that ships in `.env.example` / `.env.production.example`.
 * `env.validation.ts` rejects it in production so it cannot reach a live
 * deployment by copy-paste.
 */
export const JWT_SECRET_PLACEHOLDER =
  'CHANGE_ME_generate_with_openssl_rand_base64_48';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET!,
  jwtIssuer: process.env.JWT_ISSUER || 'ordermesh-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'ordermesh-web',

  accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10),

  /** Sliding window: how long one refresh token lives. */
  refreshTtlDays: parseInt(process.env.AUTH_REFRESH_TTL_DAYS || '30', 10),
  /** Hard ceiling for a whole rotation family, regardless of rotations. */
  refreshAbsoluteTtlDays: parseInt(
    process.env.AUTH_REFRESH_ABSOLUTE_TTL_DAYS || '90',
    10,
  ),

  /**
   * Upper bound on how stale a cached permission/status snapshot may be.
   * 0 disables caching entirely (the default outside production, so tests see
   * their own writes immediately).
   */
  permissionCacheTtlMs: parseInt(
    process.env.AUTH_PERMISSION_CACHE_TTL_MS || '0',
    10,
  ),
}));
