import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { USER_ROLES, User, UserRole } from './user.entity';

/** Append-only audit of role changes; `changedBy` is NULL only for the console bootstrap. */
@Entity('user_role_changes')
@Index('user_role_changes_user_id_changed_at_idx', ['userId', 'changedAt'])
@Check('user_role_changes_role_changed', `previous_role <> new_role`)
@Check(
  'user_role_changes_bootstrap',
  `changed_by IS NOT NULL OR (new_role = 'admin' AND reason IS NOT NULL AND btrim(reason) <> '')`,
)
export class UserRoleChange {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'user_role_changes_user_id_fkey' })
  user?: User;

  @Column({ name: 'changed_by', type: 'integer', nullable: true })
  changedById: number | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'changed_by', foreignKeyConstraintName: 'user_role_changes_changed_by_fkey' })
  changedBy?: User | null;

  @Column({ name: 'previous_role', type: 'enum', enum: USER_ROLES, enumName: 'user_role' })
  previousRole: UserRole;

  @Column({ name: 'new_role', type: 'enum', enum: USER_ROLES, enumName: 'user_role' })
  newRole: UserRole;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
