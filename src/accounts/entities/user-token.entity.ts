import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';

export type UserTokenPurpose = 'email_verify' | 'password_reset' | 'email_change';

/** A one-time token bound to one account and purpose; only its hash is stored. */
@Entity('user_tokens')
@Unique('user_tokens_token_hash_key', ['tokenHash'])
@Index('user_tokens_user_id_purpose_idx', ['userId', 'purpose'])
@Check('user_tokens_target_email_purpose', `(purpose = 'email_change') = (target_email IS NOT NULL)`)
@Check(
  'user_tokens_target_email_format',
  `target_email IS NULL OR (target_email ~ '^[^@\\s]+@[^@\\s]+$' AND target_email = lower(target_email))`,
)
export class UserToken {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'user_tokens_user_id_fkey' })
  user?: User;

  @Column({ type: 'enum', enum: ['email_verify', 'password_reset', 'email_change'], enumName: 'user_token_purpose' })
  purpose: UserTokenPurpose;

  @Column({ name: 'target_email', type: 'varchar', length: 254, nullable: true })
  targetEmail: string | null;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
