import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';

/** A renewable session; only the hash of its refresh token is stored. */
@Entity('auth_sessions')
@Unique('auth_sessions_token_hash_key', ['tokenHash'])
@Index('auth_sessions_user_id_idx', ['userId'])
export class AuthSession {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'auth_sessions_user_id_fkey' })
  user?: User;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 512 })
  userAgent: string;

  @Column({ name: 'ip_address', type: 'inet' })
  ipAddress: string;

  /** Absolute deadline; renewal never extends it. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
