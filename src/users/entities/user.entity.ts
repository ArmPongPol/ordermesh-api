import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Single source of truth for the status vocabulary, shared by the entity's
 * CHECK constraint, the migration's SQL and the DTO's `@ApiProperty({ enum })`.
 */
export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USERS_STATUS_CHECK = 'users_status_check';

@Entity('users')
// varchar + CHECK, never a native Postgres enum: `ALTER TYPE ... ADD VALUE`
// cannot run in the same transaction that uses the new value, and renaming or
// removing a value is close to impossible (docs/schema.dbml [DEC 1]).
@Check(USERS_STATUS_CHECK, `"status" IN ('ACTIVE','INACTIVE','SUSPENDED')`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Deliberately NOT `unique: true`.
   *
   * Uniqueness is enforced by the expression index `uq_users_email_lower`
   * (`docs/schema.dbml` [FIX 3]) so that Somchai@example.com and
   * somchai@example.com cannot both register and race for the same identity.
   * A plain unique constraint here is case-SENSITIVE and would reopen that hole
   * while looking like it had closed it — do not add one.
   *
   * The address is stored exactly as the user typed it (receipts and support
   * replies should show their casing); every lookup matches on `lower(email)`.
   */
  @Column({ name: 'email', type: 'varchar', length: 320 })
  email: string;

  /**
   * `select: false` is the real defence against leaking the hash: a bare
   * `find()` cannot even load the column. `@Exclude()` would do nothing here —
   * no ClassSerializerInterceptor is registered in this app.
   *
   * Reading it back requires an explicit `.addSelect('user.passwordHash')`.
   */
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    select: false,
  })
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 160 })
  fullName: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
