import type { AuthenticatedUser } from './authenticated-user';

/**
 * `JwtAuthGuard` assigns the resolved snapshot to `req.user`; `@CurrentUser()`
 * reads it back. Optional because unauthenticated (`@Public()`) requests reach
 * handlers with nothing set.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
