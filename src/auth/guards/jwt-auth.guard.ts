import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  accountNotActive,
  invalidToken,
} from '../../common/exceptions/app.exception';
import { AuthContextService } from '../auth-context.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

/**
 * Authenticates every request by default. Routes opt out with `@Public()`.
 *
 * Written against `@nestjs/jwt` directly rather than passport-jwt: this guard
 * has to distinguish TOKEN_EXPIRED from INVALID_TOKEN (passport collapses both
 * into one opaque failure), resolve a permission snapshot, and honour
 * `@Public()` — which is more overriding than the strategy saves.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly authContext: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Non-HTTP contexts have no Authorization header to read.
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = TokenService.extractBearer(request.headers.authorization);
    if (!token) {
      throw invalidToken('Missing bearer token');
    }

    const claims = this.tokens.verifyAccessToken(token);

    // Authorization is resolved here, not decoded from the token, so a revoked
    // role or a suspended account takes effect without waiting for expiry.
    const snapshot = await this.authContext.get(claims.sub);
    if (!snapshot) {
      // The token is validly signed but its subject is gone (deleted account,
      // or a token minted against a different database).
      throw invalidToken('Token subject no longer exists');
    }

    if (snapshot.status !== 'ACTIVE') {
      throw accountNotActive(snapshot.status);
    }

    request.user = { ...snapshot, tokenId: claims.jti };
    return true;
  }
}
