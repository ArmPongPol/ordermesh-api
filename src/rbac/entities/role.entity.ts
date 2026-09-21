import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // A single-column unique is safe to declare here: TypeORM's schema builder
  // only drops composite unique constraints it cannot match, so this will not
  // churn on `migration:generate` the way a multi-column one would.
  @Column({ name: 'name', type: 'varchar', length: 64, unique: true })
  name: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /**
   * Marks the roles seeded by the migration. An admin UI must refuse to delete
   * or rename these — losing ADMIN locks everyone out of the system.
   */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  // Not in docs/schema.dbml. Added deliberately: roles are now user-editable
  // (an admin retunes permissions), so "when did this change" is a real question.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
