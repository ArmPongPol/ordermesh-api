import { ErrorCode } from '../common/constants/error-code';
import { AppHttpException } from '../common/exceptions/app.exception';
import type { User } from '../users/entities/user.entity';
import type { UsersService } from '../users/users.service';
import { AuthContextService } from './auth-context.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import type { AuthenticatedUser } from './types/authenticated-user';

const SNAPSHOT: AuthenticatedUser = {
  id: 'user-1',
  email: 'Somchai@Example.com',
  fullName: 'Somchai Jaidee',
  status: 'ACTIVE',
  roles: ['CUSTOMER'],
  permissions: ['order:read'],
};

const USER = {
  id: 'user-1',
  email: 'Somchai@Example.com',
  passwordHash: '$argon2id$stored',
  fullName: 'Somchai Jaidee',
  status: 'ACTIVE',
} as User;

function makeService(
  options: {
    found?: User | null;
    passwordOk?: boolean;
    needsRehash?: boolean;
    snapshot?: AuthenticatedUser | null;
  } = {},
) {
  const findByEmailWithPassword = jest
    .fn()
    .mockResolvedValue(options.found === undefined ? USER : options.found);
  const createWithRole = jest.fn().mockResolvedValue(USER);
  const updatePasswordHash = jest.fn().mockResolvedValue(undefined);
  const users = {
    findByEmailWithPassword,
    createWithRole,
    updatePasswordHash,
  } as unknown as UsersService;

  const hash = jest.fn().mockResolvedValue('$argon2id$new');
  const verify = jest.fn().mockResolvedValue(options.passwordOk ?? true);
  const verifyDummy = jest.fn().mockResolvedValue(undefined);
  const needsRehash = jest.fn().mockReturnValue(options.needsRehash ?? false);
  const passwords = {
    hash,
    verify,
    verifyDummy,
    needsRehash,
  } as unknown as PasswordService;

  const tokens = {
    signAccessToken: jest.fn().mockReturnValue('access-token'),
    accessTtlSeconds: 900,
  } as unknown as TokenService;

  const issue = jest.fn().mockResolvedValue({
    token: 'id.secret',
    familyId: 'family-1',
    expiresAt: new Date(),
  });
  const rotate = jest.fn().mockResolvedValue({
    issued: {
      token: 'id2.secret2',
      familyId: 'family-1',
      expiresAt: new Date(),
    },
    userId: 'user-1',
  });
  const revoke = jest.fn().mockResolvedValue(true);
  const revokeAllForUser = jest.fn().mockResolvedValue(2);
  const refreshTokens = {
    issue,
    rotate,
    revoke,
    revokeAllForUser,
  } as unknown as RefreshTokenService;

  const get = jest
    .fn()
    .mockResolvedValue(
      options.snapshot === undefined ? SNAPSHOT : options.snapshot,
    );
  const invalidate = jest.fn();
  const authContext = { get, invalidate } as unknown as AuthContextService;

  const service = new AuthService(
    users,
    passwords,
    tokens,
    refreshTokens,
    authContext,
  );

  return {
    service,
    createWithRole,
    updatePasswordHash,
    hash,
    verify,
    verifyDummy,
    needsRehash,
    revoke,
    revokeAllForUser,
    invalidate,
  };
}

async function thrown(fn: () => Promise<unknown>): Promise<AppHttpException> {
  try {
    await fn();
  } catch (error) {
    return error as AppHttpException;
  }
  throw new Error('expected the call to reject');
}

describe('AuthService', () => {
  describe('login', () => {
    it('returns the profile and a token pair', async () => {
      const { service } = makeService();

      const session = await service.login(
        { email: 'somchai@example.com', password: 'pw' },
        {},
      );

      expect(session.user.roles).toEqual(['CUSTOMER']);
      expect(session.tokens).toEqual({
        accessToken: 'access-token',
        refreshToken: 'id.secret',
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    });

    it('never returns the password hash', async () => {
      const { service } = makeService();

      const session = await service.login(
        { email: 'somchai@example.com', password: 'pw' },
        {},
      );

      expect(JSON.stringify(session)).not.toContain('argon2');
      expect(JSON.stringify(session)).not.toContain('passwordHash');
    });

    // The headline anti-enumeration property: the two failures must be
    // indistinguishable to the caller, byte for byte.
    it('produces identical errors for an unknown email and a wrong password', async () => {
      const unknown = await thrown(() =>
        makeService({ found: null }).service.login(
          { email: 'nobody@example.com', password: 'pw' },
          {},
        ),
      );
      const wrongPassword = await thrown(() =>
        makeService({ passwordOk: false }).service.login(
          { email: 'somchai@example.com', password: 'pw' },
          {},
        ),
      );

      expect(unknown.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect(unknown.getStatus()).toBe(wrongPassword.getStatus());
      expect(unknown.code).toBe(wrongPassword.code);
      expect(unknown.getResponse()).toEqual(wrongPassword.getResponse());
    });

    // Matching messages are not enough: without the dummy verify the unknown
    // path returns measurably sooner, which is the same leak by another route.
    it('burns an argon2 verify even when no user was found', async () => {
      const { service, verifyDummy } = makeService({ found: null });

      await thrown(() =>
        service.login({ email: 'nobody@example.com', password: 'pw' }, {}),
      );

      expect(verifyDummy).toHaveBeenCalledWith('pw');
    });

    it('refuses a suspended account and ends its sessions', async () => {
      const { service, revokeAllForUser } = makeService({
        found: { ...USER, status: 'SUSPENDED' },
      });

      const error = await thrown(() =>
        service.login({ email: 'somchai@example.com', password: 'pw' }, {}),
      );

      expect(error.code).toBe(ErrorCode.ACCOUNT_SUSPENDED);
      expect(error.getStatus()).toBe(403);
      expect(revokeAllForUser).toHaveBeenCalledWith('user-1', 'USER_DISABLED');
    });

    // Checked after the password, so the suspended-account response cannot be
    // provoked by someone who does not know the credential.
    it('checks the password before the account status', async () => {
      const { service, verify } = makeService({
        found: { ...USER, status: 'SUSPENDED' },
        passwordOk: false,
      });

      const error = await thrown(() =>
        service.login({ email: 'somchai@example.com', password: 'wrong' }, {}),
      );

      expect(error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect(verify).toHaveBeenCalled();
    });

    it('upgrades a weak hash on successful login', async () => {
      const { service, updatePasswordHash, hash } = makeService({
        needsRehash: true,
      });

      await service.login({ email: 'somchai@example.com', password: 'pw' }, {});

      expect(hash).toHaveBeenCalledWith('pw');
      expect(updatePasswordHash).toHaveBeenCalledWith(
        'user-1',
        '$argon2id$new',
      );
    });

    it('leaves an up-to-date hash alone', async () => {
      const { service, updatePasswordHash } = makeService({
        needsRehash: false,
      });

      await service.login({ email: 'somchai@example.com', password: 'pw' }, {});

      expect(updatePasswordHash).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('hashes the password and starts a session', async () => {
      const { service, createWithRole, hash } = makeService({ found: null });

      const session = await service.register(
        {
          email: 'New@Example.com',
          password: 'a long passphrase',
          fullName: 'New Person',
        },
        {},
      );

      expect(hash).toHaveBeenCalledWith('a long passphrase');
      expect(createWithRole).toHaveBeenCalledWith({
        // Stored exactly as submitted — casing is preserved, matching is done
        // on lower(email).
        email: 'New@Example.com',
        passwordHash: '$argon2id$new',
        fullName: 'New Person',
      });
      expect(session.tokens.refreshToken).toBe('id.secret');
    });

    it('rejects an email that already exists', async () => {
      const { service } = makeService({ found: USER });

      const error = await thrown(() =>
        service.register(
          { email: 'somchai@example.com', password: 'pw123456', fullName: 'X' },
          {},
        ),
      );

      expect(error.code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
      expect(error.getStatus()).toBe(409);
    });
  });

  describe('refresh', () => {
    it('rotates and returns a new pair', async () => {
      const { service } = makeService();

      await expect(service.refresh('id.secret', {})).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'id2.secret2',
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    });

    // A user suspended mid-session must not be able to mint a new access token,
    // and killing the family stops them outliving the current one.
    it('refuses and revokes the family when the account is no longer active', async () => {
      const { service, revokeAllForUser } = makeService({
        snapshot: { ...SNAPSHOT, status: 'SUSPENDED' },
      });

      const error = await thrown(() => service.refresh('id.secret', {}));

      expect(error.code).toBe(ErrorCode.ACCOUNT_SUSPENDED);
      expect(revokeAllForUser).toHaveBeenCalledWith('user-1', 'USER_DISABLED');
    });

    it('refuses when the subject no longer exists', async () => {
      const { service } = makeService({ snapshot: null });

      expect((await thrown(() => service.refresh('id.secret', {}))).code).toBe(
        ErrorCode.INVALID_TOKEN,
      );
    });
  });

  describe('logout', () => {
    it('revokes the presented token and drops the cached snapshot', async () => {
      const { service, revoke, invalidate } = makeService();

      await service.logout('user-1', 'id.secret');

      expect(revoke).toHaveBeenCalledWith('id.secret', 'LOGOUT');
      expect(invalidate).toHaveBeenCalledWith('user-1');
    });

    it('logout-all reports how many sessions ended', async () => {
      const { service, revokeAllForUser } = makeService();

      await expect(service.logoutAll('user-1')).resolves.toBe(2);
      expect(revokeAllForUser).toHaveBeenCalledWith('user-1', 'LOGOUT_ALL');
    });
  });
});
