import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../common/constants/error-code';
import { AppHttpException } from '../common/exceptions/app.exception';
import { TokenService } from './token.service';

const SECRET = 'a'.repeat(48);
const SETTINGS: Record<string, unknown> = {
  'auth.jwtSecret': SECRET,
  'auth.jwtIssuer': 'ordermesh-api',
  'auth.jwtAudience': 'ordermesh-web',
  'auth.accessTtlSeconds': 900,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const config = {
    getOrThrow: jest.fn((key: string) => ({ ...SETTINGS, ...overrides })[key]),
  } as unknown as ConfigService;

  return new TokenService(new JwtService(), config);
}

/** The code the filter would report for a thrown AppHttpException. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as AppHttpException).code;
  }
  throw new Error('expected the call to throw');
}

describe('TokenService', () => {
  it('round-trips a signed access token', () => {
    const service = makeService();
    const claims = service.verifyAccessToken(
      service.signAccessToken('user-1', 'session-1'),
    );

    expect(claims.sub).toBe('user-1');
    expect(claims.jti).toBe('session-1');
    expect(claims.typ).toBe('access');
  });

  // The token is only an identity assertion: authorization is resolved from the
  // database per request, so a revoked role takes effect without waiting for
  // the token to expire.
  it('carries no roles or permissions', () => {
    const service = makeService();
    const claims = service.verifyAccessToken(service.signAccessToken('user-1'));

    expect(claims).not.toHaveProperty('roles');
    expect(claims).not.toHaveProperty('permissions');
  });

  it('rejects a token signed with a different secret', () => {
    const foreign = makeService({ 'auth.jwtSecret': 'b'.repeat(48) });
    const token = foreign.signAccessToken('user-1');

    expect(codeOf(() => makeService().verifyAccessToken(token))).toBe(
      ErrorCode.INVALID_TOKEN,
    );
  });

  it('rejects a token issued for another issuer or audience', () => {
    const otherIssuer = makeService({ 'auth.jwtIssuer': 'somewhere-else' });
    const otherAudience = makeService({ 'auth.jwtAudience': 'another-app' });
    const service = makeService();

    expect(
      codeOf(() =>
        service.verifyAccessToken(otherIssuer.signAccessToken('user-1')),
      ),
    ).toBe(ErrorCode.INVALID_TOKEN);
    expect(
      codeOf(() =>
        service.verifyAccessToken(otherAudience.signAccessToken('user-1')),
      ),
    ).toBe(ErrorCode.INVALID_TOKEN);
  });

  // Expired must be distinguishable from invalid, or the client cannot tell
  // "refresh" from "sign in again".
  it('reports an expired token as TOKEN_EXPIRED, not INVALID_TOKEN', () => {
    const expired = makeService({ 'auth.accessTtlSeconds': -1 });
    const token = expired.signAccessToken('user-1');

    expect(codeOf(() => makeService().verifyAccessToken(token))).toBe(
      ErrorCode.TOKEN_EXPIRED,
    );
  });

  it('rejects garbage without leaking an internal error', () => {
    const service = makeService();

    for (const bad of ['', 'not.a.token', 'aaaa', 'a.b.c']) {
      expect(codeOf(() => service.verifyAccessToken(bad))).toBe(
        ErrorCode.INVALID_TOKEN,
      );
    }
  });

  // Without the `typ` check a refresh token would satisfy signature, issuer and
  // audience, and sail straight through the auth guard.
  it('refuses a token that is not typed as an access token', () => {
    const service = makeService();
    const disguised = new JwtService().sign(
      { sub: 'user-1', jti: 'x', typ: 'refresh' },
      {
        secret: SECRET,
        issuer: 'ordermesh-api',
        audience: 'ordermesh-web',
        expiresIn: 900,
      },
    );

    expect(codeOf(() => service.verifyAccessToken(disguised))).toBe(
      ErrorCode.INVALID_TOKEN,
    );
  });

  describe('extractBearer', () => {
    it('accepts a well-formed header, case-insensitively on the scheme', () => {
      expect(TokenService.extractBearer('Bearer abc')).toBe('abc');
      expect(TokenService.extractBearer('bearer abc')).toBe('abc');
    });

    it('rejects anything else', () => {
      expect(TokenService.extractBearer(undefined)).toBeNull();
      expect(TokenService.extractBearer('')).toBeNull();
      expect(TokenService.extractBearer('abc')).toBeNull();
      expect(TokenService.extractBearer('Bearer')).toBeNull();
      expect(TokenService.extractBearer('Bearer ')).toBeNull();
      expect(TokenService.extractBearer('Basic abc')).toBeNull();
      // Trailing junk must not be silently ignored.
      expect(TokenService.extractBearer('Bearer abc def')).toBeNull();
    });
  });
});
