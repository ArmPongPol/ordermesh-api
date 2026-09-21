import * as argon2 from 'argon2';

/**
 * OWASP's baseline argon2id configuration (19 MiB, 2 iterations, 1 lane).
 *
 * Deliberately constants, not environment variables. An env var here is a
 * foot-gun: changing it rehashes nothing, so the fleet would silently hold a
 * mixture of strengths with no record of which is which. argon2 hashes are
 * self-describing, so these can be raised at any time and
 * `PasswordService.verify` upgrades each hash on the owner's next login.
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Refresh-token secrets are 32 bytes of CSPRNG output, not user-chosen
 * passwords — there is no dictionary to grind, so the password parameters buy
 * nothing and would cost ~30 ms on every refresh. Reduced deliberately.
 */
export const TOKEN_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 8192,
  timeCost: 1,
  parallelism: 1,
} as const;

/** Bytes of entropy in the secret half of a refresh token. */
export const REFRESH_TOKEN_SECRET_BYTES = 32;

/**
 * Throttle override for credential endpoints. The global ThrottlerGuard allows
 * 120/min per IP, which is far too generous for a login form.
 */
export const LOGIN_THROTTLE = {
  default: {
    // These are `Resolvable<number>` functions on purpose. A bare
    // `process.env.X` read would run at decorator-evaluation time — before
    // ConfigModule has loaded any .env file — and always see undefined.
    // Evaluated per request, they see the values Joi validated and wrote back
    // into process.env.
    limit: () => Number(process.env.AUTH_LOGIN_THROTTLE_LIMIT ?? 5),
    ttl: () => Number(process.env.AUTH_LOGIN_THROTTLE_TTL ?? 60_000),
    blockDuration: () => Number(process.env.AUTH_LOGIN_BLOCK_MS ?? 900_000),
    // Tracked per (IP, email) pair. Tracking by email alone would let anyone
    // lock a known account out of its own login — a targeted denial of service
    // dressed up as a security control.
    getTracker: (req: { ip?: string; body?: unknown }): string => {
      const body = (req.body ?? {}) as { email?: unknown };
      const email = typeof body.email === 'string' ? body.email : '';
      return `login:${req.ip ?? ''}:${email.trim().toLowerCase()}`;
    },
  },
} as const;
