import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Role } from './role.entity';

/**
 * An explicit join entity rather than `@ManyToMany` + `@JoinTable`: the audit
 * columns below cannot live on a generated join table, and "who granted this
 * person payment:refund, and when" is precisely the question a
 * privilege-escalation incident asks first.
 */
@Entity('user_roles')
// The composite PK already indexes user_id; role_id needs its own index for
// "who holds this role" and to keep role deletes off a full scan
// (docs/schema.dbml [FIX 4]).
@Index('ix_user_roles_role', ['roleId'])
export class UserRole {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  /** Null for grants made by the system (registration, seeding). */
  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_user_roles_user',
  })
  user: User;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'role_id',
    foreignKeyConstraintName: 'fk_user_roles_role',
  })
  role: Role;

  // SET NULL, not CASCADE: deleting the admin who made a grant must not delete
  // the grant itself.
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'assigned_by',
    foreignKeyConstraintName: 'fk_user_roles_assigned_by',
  })
  assignedByUser: User | null;
}
