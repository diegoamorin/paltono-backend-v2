import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type UserStatus = 'active' | 'suspended' | 'deleted';
export type UserRole = 'user' | 'moderator' | 'admin';

// Mirrors the CreateAccounts migration, so `migration:generate` finds no drift. The
// case-insensitive email index is an expression index, which TypeORM leaves alone.
@Entity('users')
@Unique('users_uuid_key', ['uuid'])
@Unique('users_username_key', ['username'])
@Check('users_username_format', `username ~ '^[a-z0-9_.]{0,29}[a-z0-9_]$'`)
@Check('users_email_required', `email IS NOT NULL OR status = 'deleted'`)
@Check('users_email_format', `email IS NULL OR email ~ '^[^@\\s]+@[^@\\s]+$'`)
@Check('users_display_name_nonblank', `btrim(display_name) <> ''`)
export class User {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ type: 'varchar', length: 30 })
  username: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 2048, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ type: 'enum', enum: ['active', 'suspended', 'deleted'], enumName: 'user_status', default: 'active' })
  status: UserStatus;

  @Column({ type: 'enum', enum: ['user', 'moderator', 'admin'], enumName: 'user_role', default: 'user' })
  role: UserRole;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'username_changed_at', type: 'timestamptz' })
  usernameChangedAt: Date;
}
