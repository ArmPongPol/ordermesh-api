import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthContextService } from '../auth/auth-context.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { emailAlreadyExists } from '../common/exceptions/app.exception';
import { DEFAULT_ROLE, RoleName } from '../rbac/constants/roles';
import { User, UserStatus } from './entities/user.entity';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly authContext: AuthContextService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /**
   * Case-insensitive lookup that also loads the password hash.
   *
   * `lower(email) = lower(:email)` is an index scan on `uq_users_email_lower` —
   * the reason that expression index exists. `addSelect` is required because
   * the column is declared `select: false`.
   */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('lower(user.email) = lower(:email)', { email })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /**
   * Creates the user and grants their default role in one transaction, so a
   * failure cannot leave an account with no role at all.
   *
   * @param roleName defaults to CUSTOMER — self-registration's grant.
   */
  async createWithRole(
    input: CreateUserInput,
    roleName: RoleName = DEFAULT_ROLE,
  ): Promise<User> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.getRepository(User).save(
          manager.getRepository(User).create({
            // Stored as typed: receipts and support replies should show the
            // user's own casing. Matching is always done on lower(email).
            email: input.email,
            passwordHash: input.passwordHash,
            fullName: input.fullName,
            status: 'ACTIVE',
          }),
        );

        await manager.query<unknown>(
          `INSERT INTO "user_roles" ("user_id", "role_id")
           SELECT $1, r."id" FROM "roles" r WHERE r."name" = $2
           ON CONFLICT DO NOTHING`,
          [user.id, roleName],
        );

        return user;
      });
    } catch (error) {
      // Two concurrent registrations both pass any pre-check and race to the
      // index; the loser lands here. Without this it would surface as a 500.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw emailAlreadyExists();
      }
      throw error;
    }
  }

  /**
   * Changes a user's status, ending their sessions when it is no longer ACTIVE.
   *
   * The revocation and the cache invalidation live here rather than in a
   * controller on purpose: an admin endpoint that forgot either one would leave
   * a suspended user holding a working session until their token expired.
   */
  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.users.update(userId, { status });

    if (status !== 'ACTIVE') {
      await this.refreshTokens.revokeAllForUser(userId, 'USER_DISABLED');
    }

    this.authContext.invalidate(userId);
  }

  /** Rehash in place after a successful login under stronger parameters. */
  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.users.update(userId, { passwordHash });
    this.authContext.invalidate(userId);
  }
}
