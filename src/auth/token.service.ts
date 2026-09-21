import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { invalidToken, tokenExpired } from '../common/exceptions/app.exception';
import type { AccessTokenClaims } from './types/authenticated-user';

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    // getOrThrow: booting without a signing key must fail loudly at startup,
    // not silently at the first login.
    this.secret = config.getOrThrow<string>('auth.jwtSecret');
    this.issuer = config.getOrThrow<string>('auth.jwtIssuer');
    this.audience = config.getOrThrow<string>('auth.jwtAudience');
    this.ttlSeconds = config.getOrThrow<number>('auth.accessTtlSeconds');
  }

  get accessTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /**
   * @param sessionId the refresh-token family this access token belongs to, so
   *   `logout` can name the session it is ending.
   */
  signAccessToken(userId: string, sessionId: string = randomUUID()): string {
    return this.jwt.sign(
      { sub: userId, jti: sessionId, typ: 'access' },
      {
        secret: this.secret,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.ttlSeconds,
      },
    );
  }

  /**
   * Throws TOKEN_EXPIRED for an expired token and INVALID_TOKEN for everything
   * else. The distinction matters to clients: expired means "refresh", invalid
   * means "sign in again".
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    let claims: AccessTokenClaims;

    try {
      claims = this.jwt.verify<AccessTokenClaims>(token, {
        secret: this.secret,
        issuer: this.issuer,
        audience: this.audience,
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw tokenExpired();
      }
      throw invalidToken();
    }

    // A refresh token must never be accepted as an access token. `verify` only
    // checks the signature and registered claims, so this is the check that
    // keeps the two kinds apart.
    if (claims.typ !== 'access') {
      throw invalidToken();
    }

    return claims;
  }

  /** Strict `Authorization: Bearer <token>`; returns null for anything else. */
  static extractBearer(header: string | undefined): string | null {
    if (!header) {
      return null;
    }

    const [scheme, value, ...rest] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value || rest.length > 0) {
      return null;
    }

    return value;
  }
}
