import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export const REVOKED_REASONS = [
  /** Superseded by a newer token in the same family. The normal path. */
  'ROTATED',
  'LOGOUT',
  'LOGOUT_ALL',
  /** An already-rotated token was replayed; the whole family was killed. */
  'REUSE_DETECTED',
  /** The owning account left ACTIVE. */
  'USER_DISABLED',
] as const;
export type RevokedReason = (typeof REVOKED_REASONS)[number];

export const REFRESH_TOKENS_REASON_CHECK =
  'refresh_tokens_revoked_reason_check';
export const REFRESH_TOKENS_EXPIRY_CHECK = 'refresh_tokens_expiry_order_check';

/**
 * One row per issued refresh token.
 *
 * The value handed to the client is compound — `<row id>.<base64url secret>` —
 * because argon2 hashes are salted and therefore not searchable: we cannot
 * `WHERE token_hash = ?`. Splitting on the dot gives a primary-key lookup
 * followed by a single `argon2.verify` against that row.
 *
 * Rotation forms a *family*: every token descended from one login shares
 * `family_id`. Replaying a token that was already rotated is the signature of a
 * stolen token, and kills the entire family.
 */
@Entity('refresh_tokens')
@Check(
  REFRESH_TOKENS_REASON_CHECK,
  `"revoked_reason" IS NULL OR "revoked_reason" IN ('ROTATED','LOGOUT','LOGOUT_ALL','REUSE_DETECTED','USER_DISABLED')`,
)
@Check(REFRESH_TOKENS_EXPIRY_CHECK, `"expires_at" <= "family_expires_at"`)
@Index('ix_refresh_tokens_user', ['userId'])
@Index('ix_refresh_tokens_family', ['familyId'])
// Partial: the only rows the expiry sweeper ever scans are the live ones, and
// this table is append-mostly so the revoked majority would otherwise bloat it.
@Index('ix_refresh_tokens_active_sweep', ['expiresAt'], {
  where: 'revoked_at IS NULL',
})
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  /** argon2 hash of the secret half only — never the compound token. */
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** 45 chars covers an IPv4-mapped IPv6 address, the longest textual form. */
  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Absolute cap for the whole family, copied forward unchanged on every
   * rotation. Without it a stolen token that keeps rotating never expires —
   * the sliding window renews itself indefinitely.
   */
  @Column({ name: 'family_expires_at', type: 'timestamptz' })
  familyExpiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({
    name: 'revoked_reason',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  revokedReason: RevokedReason | null;

  /** Audit trail of the rotation chain; not a FK, so a purge cannot dangle. */
  @Column({ name: 'replaced_by_token_id', type: 'uuid', nullable: true })
  replacedByTokenId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_refresh_tokens_user',
  })
  user: User;
}
