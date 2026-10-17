import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { USER_STATUSES, User, UserStatus } from './user.entity';

/**
 * Append-only audit of status changes. `changedBy` is the administrator, or the
 * account itself for a voluntary deletion, the only change without a reason.
 */
@Entity('user_status_changes')
@Index('user_status_changes_user_id_changed_at_idx', ['userId', 'changedAt'])
@Check(
  'user_status_changes_transition',
  `(previous_status, new_status) IN (('active', 'suspended'), ('suspended', 'active'), ('active', 'deleted'), ('suspended', 'deleted'))`,
)
@Check(
  'user_status_changes_voluntary_deletion',
  `NOT (previous_status = 'active' AND new_status = 'deleted') OR changed_by = user_id`,
)
@Check(
  'user_status_changes_reason',
  `(reason IS NOT NULL AND btrim(reason) <> '') OR (previous_status = 'active' AND new_status = 'deleted' AND changed_by = user_id)`,
)
export class UserStatusChange {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'user_status_changes_user_id_fkey' })
  user?: User;

  @Column({ name: 'changed_by', type: 'integer' })
  changedById: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'changed_by', foreignKeyConstraintName: 'user_status_changes_changed_by_fkey' })
  changedBy?: User;

  @Column({ name: 'previous_status', type: 'enum', enum: USER_STATUSES, enumName: 'user_status' })
  previousStatus: UserStatus;

  @Column({ name: 'new_status', type: 'enum', enum: USER_STATUSES, enumName: 'user_status' })
  newStatus: UserStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
