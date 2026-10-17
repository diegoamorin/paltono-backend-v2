import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';

/** The local password of an account; shares its primary key with `users`. */
@Entity('user_credentials')
export class UserCredential {
  @PrimaryColumn({ name: 'user_id', type: 'integer' })
  userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'user_credentials_user_id_fkey' })
  user?: User;

  /** Argon2id PHC string. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  passwordChangedAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
