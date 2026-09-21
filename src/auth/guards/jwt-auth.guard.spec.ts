import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/constants/error-code';
import {
  AppHttpException,
  tokenExpired,
} from '../../common/exceptions/app.exception';
import { AuthContextService } from '../auth-context.service';
import { TokenService } from '../token.service';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { JwtAuthGuard } from './jwt-auth.guard';

const SNAPSHOT: AuthenticatedUser = {
  id: 'user-1',
  email: 'somchai@example.com',
  fullName: 'Somchai Jaidee',
  status: 'ACTIVE',
  roles: ['CUSTOMER'],
  permissions: ['order:read'],
};

function makeContext(authorization?: string) {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };

  const context = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function makeGuard(options: {
  isPublic?: boolean;
  claims?: { sub: string; jti: string };
  verifyThrows?: Error;
  snapshot?: AuthenticatedUser | null;
}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(options.isPublic),
  } as unknown as Reflector;

  const verifyAccessToken = jest.fn(() => {
    if (options.verifyThrows) {
      throw options.verifyThrows;
    }
    return options.claims ?? { sub: 'user-1', jti: 'session-1' };
  });

  const tokens = { verifyAccessToken } as unknown as TokenService;

  const get = jest
    .fn()
    .mockResolvedValue(
      options.snapshot === undefined ? SNAPSHOT : options.snapshot,
    );
  const authContext = { get } as unknown as AuthContextService;

  return {
    guard: new JwtAuthGuard(reflector, tokens, authContext),
    verifyAccessToken,
    get,
  };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as AppHttpException).code;
  }
  throw new Error('expected the call to reject');
}

describe('JwtAuthGuard', () => {
  // The short-circuit must come before any header parsing, so a public route
  // is reachable with a malformed Authorization header present.
  it('lets @Public() routes through without reading the token', async () => {
    const { guard, verifyAccessToken, get } = makeGuard({ isPublic: true });
    const { context } = makeContext('Basic nonsense');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('populates req.user with the resolved snapshot and the token jti', async () => {
    const { guard } = makeGuard({ claims: { sub: 'user-1', jti: 'sess-9' } });
    const { context, request } = makeContext('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ ...SNAPSHOT, tokenId: 'sess-9' });
  });

  it('rejects a missing or non-bearer Authorization header', async () => {
    for (const header of [undefined, '', 'Basic abc', 'token abc', 'Bearer']) {
      const { guard } = makeGuard({});
      const { context } = makeContext(header);

      expect(await codeOf(() => guard.canActivate(context))).toBe(
        ErrorCode.INVALID_TOKEN,
      );
    }
  });

  // The distinction reaches the client, which uses it to choose between
  // refreshing and sending the user back to the login screen.
  it('propagates TOKEN_EXPIRED rather than flattening it to INVALID_TOKEN', async () => {
    const { guard } = makeGuard({ verifyThrows: tokenExpired() });
    const { context } = makeContext('Bearer expired-token');

    expect(await codeOf(() => guard.canActivate(context))).toBe(
      ErrorCode.TOKEN_EXPIRED,
    );
  });

  // A validly signed token whose subject no longer exists — a deleted account,
  // or a token minted against a different database.
  it('rejects a token whose subject has no snapshot', async () => {
    const { guard } = makeGuard({ snapshot: null });
    const { context } = makeContext('Bearer good-token');

    expect(await codeOf(() => guard.canActivate(context))).toBe(
      ErrorCode.INVALID_TOKEN,
    );
  });

  // 403 and not 401: the credential is valid, the account is not. A 401 would
  // send the client into a refresh that also fails — a logout loop.
  it('refuses a suspended or inactive account with 403', async () => {
    const suspended = makeGuard({
      snapshot: { ...SNAPSHOT, status: 'SUSPENDED' },
    });
    const inactive = makeGuard({
      snapshot: { ...SNAPSHOT, status: 'INACTIVE' },
    });

    expect(
      await codeOf(() =>
        suspended.guard.canActivate(makeContext('Bearer t').context),
      ),
    ).toBe(ErrorCode.ACCOUNT_SUSPENDED);
    expect(
      await codeOf(() =>
        inactive.guard.canActivate(makeContext('Bearer t').context),
      ),
    ).toBe(ErrorCode.ACCOUNT_INACTIVE);
  });

  // This is what makes a revoked role take effect immediately instead of when
  // the access token happens to expire.
  it('resolves authorization from the context, not from the token', async () => {
    const { guard, get } = makeGuard({ claims: { sub: 'user-42', jti: 's' } });
    const { context } = makeContext('Bearer good-token');

    await guard.canActivate(context);

    expect(get).toHaveBeenCalledWith('user-42');
  });
});
