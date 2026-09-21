/**
 * Runs before the test framework and before any spec imports AppModule.
 *
 * That ordering is the whole point: `ConfigModule.forRoot()` executes while
 * `app.module.ts` is being imported, and both dotenv and the Joi write-back
 * leave already-present `process.env` values alone. Setting these here is
 * therefore the only way to override them without a gitignored `.env.test`.
 */

// The auth suite legitimately makes far more credential calls than a human
// would - it exercises wrong passwords, replays and duplicate registrations -
// and the production limit of 5 per (IP, email) would throttle the suite
// against itself. The throttler's own behaviour is covered separately.
// 100 is the schema's ceiling, and comfortably above what this suite needs.
process.env.AUTH_LOGIN_THROTTLE_LIMIT = '100';
process.env.AUTH_LOGIN_BLOCK_MS = '0';
process.env.THROTTLE_LIMIT = '10000';

// No permission caching, so a role or status change written by a test is
// visible to the very next request.
process.env.AUTH_PERMISSION_CACHE_TTL_MS = '0';
