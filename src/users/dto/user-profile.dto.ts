import { ApiProperty } from '@nestjs/swagger';
import { USER_STATUSES } from '../entities/user.entity';
// `import type` is required for types used in decorated signatures while
// isolatedModules + emitDecoratorMetadata are both on.
import type { User, UserStatus } from '../entities/user.entity';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * The only shape a user is ever returned in.
 *
 * Controllers must never return a `User` entity. `select: false` already keeps
 * `passwordHash` out of ordinary queries, but a login flow loads it explicitly
 * — this mapper is what guarantees it cannot travel any further.
 */
export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'somchai@example.com' })
  email: string;

  @ApiProperty({ example: 'Somchai Jaidee' })
  fullName: string;

  @ApiProperty({ enum: USER_STATUSES, example: 'ACTIVE' })
  status: UserStatus;

  @ApiProperty({ isArray: true, type: String, example: ['CUSTOMER'] })
  roles: string[];

  @ApiProperty({
    isArray: true,
    type: String,
    example: ['order:create', 'order:read'],
    description:
      'Flattened from every role the user holds. Clients may use these to hide actions, but the API enforces them regardless.',
  })
  permissions: string[];
}

/** From the request snapshot (roles and permissions already resolved). */
export function toUserProfileDto(user: AuthenticatedUser): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roles: [...user.roles],
    permissions: [...user.permissions],
  };
}

/** From an entity, for paths that know the grants without a snapshot query. */
export function entityToUserProfileDto(
  user: User,
  roles: readonly string[] = [],
  permissions: readonly string[] = [],
): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roles: [...roles],
    permissions: [...permissions],
  };
}
