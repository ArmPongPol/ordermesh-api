import { SetMetadata } from '@nestjs/common';

/**
 * Exported so `JwtAuthGuard` imports the key rather than retyping a string
 * literal. A mismatch between the two is silent and total — it was exactly this
 * bug that made `@SkipTransform()` a no-op (api-contract-hardening.md §2.6),
 * except here the failure mode is an endpoint that authenticates when it should
 * not, or vice versa.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Opts a route (or a whole controller) out of the global JWT auth guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
