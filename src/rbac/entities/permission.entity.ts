import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const PERMISSIONS_CODE_FORMAT_CHECK = 'permissions_code_format_check';

/**
 * Permission codes are `<resource>:<action>`, lowercase snake, singular
 * resource. A trailing `:any` means "across all owners"; the bare form means
 * "own records only" (e.g. `order:read` vs `order:read:any`).
 */
@Entity('permissions')
// A typo'd code is otherwise unfalsifiable: @RequirePermissions('order:updat')
// would simply 403 forever and look like a permissions misconfiguration.
@Check(PERMISSIONS_CODE_FORMAT_CHECK, `"code" ~ '^[a-z_]+:[a-z_]+(:any)?$'`)
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'code', type: 'varchar', length: 64, unique: true })
  code: string;

  @Column({ name: 'resource', type: 'varchar', length: 32 })
  resource: string;

  @Column({ name: 'action', type: 'varchar', length: 32 })
  action: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
