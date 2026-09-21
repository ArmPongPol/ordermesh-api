import { DataSource, Repository } from 'typeorm';
import { AuthContextService } from '../auth/auth-context.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { ErrorCode } from '../common/constants/error-code';
import { AppHttpException } from '../common/exceptions/app.exception';
import { User } from './entities/user.entity';
import {
  entityToUserProfileDto,
  toUserProfileDto,
} from './dto/user-profile.dto';
import { UsersService } from './users.service';

const USER = {
  id: 'user-1',
  email: 'Somchai@Example.com',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$verysecret',
  fullName: 'Somchai Jaidee',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

function makeService(options: { saveRejectsWith?: Error } = {}) {
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(USER),
  };

  const users = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn().mockResolvedValue(USER),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as unknown as Repository<User>;

  const managerRepo = {
    create: jest.fn((input: Partial<User>) => input as User),
    save: jest.fn((input: User) =>
      options.saveRejectsWith
        ? Promise.reject(options.saveRejectsWith)
        : Promise.resolve({ ...USER, ...input }),
    ),
  };
  const managerQuery = jest.fn().mockResolvedValue(undefined);

  const dataSource = {
    transaction: (cb: (m: unknown) => unknown) =>
      cb({ getRepository: () => managerRepo, query: managerQuery }),
  } as unknown as DataSource;

  // Held as bare jest.fn()s so assertions never reference them through the
  // mock object, which would trip @typescript-eslint/unbound-method.
  const invalidate = jest.fn();
  const authContext = { invalidate } as unknown as AuthContextService;

  const revokeAllForUser = jest.fn().mockResolvedValue(3);
  const refreshTokens = { revokeAllForUser } as unknown as RefreshTokenService;

  return {
    service: new UsersService(users, dataSource, authContext, refreshTokens),
    users,
    queryBuilder,
    managerQuery,
    invalidate,
    revokeAllForUser,
  };
}

describe('UsersService', () => {
  describe('findByEmailWithPassword', () => {
    // The lower() comparison is what makes the uq_users_email_lower index
    // usable; an ILIKE or a plain equality would either miss or seq-scan.
    it('matches case-insensitively and explicitly selects the hash', async () => {
      const { service, queryBuilder } = makeService();

      await service.findByEmailWithPassword('SOMCHAI@example.com');

      expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.passwordHash');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'lower(user.email) = lower(:email)',
        { email: 'SOMCHAI@example.com' },
      );
    });
  });

  describe('createWithRole', () => {
    it('creates the user and grants CUSTOMER by default', async () => {
      const { service, managerQuery } = makeService();

      await service.createWithRole({
        email: 'New@Example.com',
        passwordHash: 'hash',
        fullName: 'New Person',
      });

      expect(managerQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "user_roles"'),
        [expect.any(String), 'CUSTOMER'],
      );
    });

    it('can grant a different role', async () => {
      const { service, managerQuery } = makeService();

      await service.createWithRole(
        { email: 'a@b.co', passwordHash: 'h', fullName: 'N' },
        'ADMIN',
      );

      expect(managerQuery).toHaveBeenCalledWith(expect.any(String), [
        expect.any(String),
        'ADMIN',
      ]);
    });

    // Two concurrent registrations both pass the pre-check and race to the
    // unique index. Without this translation the loser gets a 500.
    it('translates a unique violation into EMAIL_ALREADY_EXISTS', async () => {
      const { service } = makeService({
        saveRejectsWith: Object.assign(new Error('duplicate key'), {
          code: '23505',
        }),
      });

      try {
        await service.createWithRole({
          email: 'taken@example.com',
          passwordHash: 'hash',
          fullName: 'X',
        });
        throw new Error('expected the call to reject');
      } catch (error) {
        expect((error as AppHttpException).code).toBe(
          ErrorCode.EMAIL_ALREADY_EXISTS,
        );
      }
    });

    it('does not swallow unrelated database errors', async () => {
      const { service } = makeService({
        saveRejectsWith: Object.assign(new Error('connection lost'), {
          code: '08006',
        }),
      });

      await expect(
        service.createWithRole({
          email: 'a@b.co',
          passwordHash: 'h',
          fullName: 'N',
        }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('setStatus', () => {
    // Both effects live here rather than in a controller precisely so a future
    // admin endpoint cannot forget one of them.
    it('revokes every session and drops the cache when deactivating', async () => {
      const { service, revokeAllForUser, invalidate } = makeService();

      await service.setStatus('user-1', 'SUSPENDED');

      expect(revokeAllForUser).toHaveBeenCalledWith('user-1', 'USER_DISABLED');
      expect(invalidate).toHaveBeenCalledWith('user-1');
    });

    it('does not revoke sessions when reactivating', async () => {
      const { service, revokeAllForUser, invalidate } = makeService();

      await service.setStatus('user-1', 'ACTIVE');

      expect(revokeAllForUser).not.toHaveBeenCalled();
      // The cache still has to be dropped, or the old status lingers.
      expect(invalidate).toHaveBeenCalledWith('user-1');
    });
  });

  it('drops the cached snapshot after a password change', async () => {
    const { service, invalidate } = makeService();

    await service.updatePasswordHash('user-1', 'new-hash');

    expect(invalidate).toHaveBeenCalledWith('user-1');
  });

  // @Exclude() would be a no-op here (no ClassSerializerInterceptor is
  // registered), so the mapper is the only thing standing between the hash and
  // a response body.
  describe('profile mapping', () => {
    it('omits the password hash from a mapped entity', () => {
      const dto = entityToUserProfileDto(USER, ['CUSTOMER'], ['order:read']);
      const serialized = JSON.stringify(dto);

      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('password_hash');
      expect(serialized).not.toContain('argon2');
      expect(dto).not.toHaveProperty('passwordHash');
    });

    it('omits the password hash from a mapped snapshot', () => {
      const dto = toUserProfileDto({
        id: USER.id,
        email: USER.email,
        fullName: USER.fullName,
        status: 'ACTIVE',
        roles: ['CUSTOMER'],
        permissions: ['order:read'],
      });

      expect(JSON.stringify(dto)).not.toContain('argon2');
      expect(Object.keys(dto).sort()).toEqual([
        'email',
        'fullName',
        'id',
        'permissions',
        'roles',
        'status',
      ]);
    });

    it('preserves the stored casing of the email', () => {
      expect(entityToUserProfileDto(USER).email).toBe('Somchai@Example.com');
    });
  });
});
