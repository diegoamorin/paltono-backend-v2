import { Check, Column, Entity, ForeignKey, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { User } from '../../accounts/entities/user.entity';
import { bigintNumber } from './bigint-number';
import { CHANGE_STATUSES, ChangeStatus, ProposalChange, ValueEnvelope } from './proposal-change.entity';

export const DECISION_ACTIONS = [
  'apply',
  'apply_rebased',
  'reject',
  'mark_conflict',
  'mark_satisfied',
  'block_dependency',
  'mark_obsolete',
  'withdraw_change',
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** Append-only record of a review action on a microchange and of the base it observed. */
@Entity('change_decisions')
@Unique('change_decisions_id_change_id_key', ['id', 'changeId'])
@Index('change_decisions_change_id_decided_at_idx', ['changeId', 'decidedAt'])
@Check('change_decisions_observed_version_nonnegative', `observed_version >= 0`)
@Check(
  'change_decisions_observed_value_envelope',
  `(observed_value IS NOT NULL AND jsonb_typeof(observed_value -> 'exists') = 'boolean') OR (observed_value IS NULL AND actor_id IS NULL AND action IN ('mark_obsolete', 'block_dependency'))`,
)
@Check('change_decisions_previous_status_open', `previous_status IN ('pending', 'conflicted')`)
@Check(
  'change_decisions_outcome',
  `(action IN ('apply', 'apply_rebased') AND resulting_status = 'applied') OR (action = 'reject' AND resulting_status = 'rejected') OR (action = 'mark_conflict' AND resulting_status = 'conflicted') OR (action = 'mark_satisfied' AND resulting_status = 'satisfied') OR (action IN ('block_dependency', 'mark_obsolete') AND resulting_status = 'blocked') OR (action = 'withdraw_change' AND resulting_status = 'withdrawn')`,
)
@Check(
  'change_decisions_actor',
  `actor_id IS NOT NULL OR action IN ('mark_conflict', 'mark_satisfied', 'block_dependency', 'mark_obsolete')`,
)
@Check(
  'change_decisions_reason',
  `action NOT IN ('mark_conflict', 'reject', 'apply_rebased', 'block_dependency', 'mark_obsolete') OR (reason IS NOT NULL AND btrim(reason) <> '')`,
)
export class ChangeDecision {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'change_id', type: 'uuid' })
  @ForeignKey(() => ProposalChange, { name: 'change_decisions_change_id_fkey', onDelete: 'RESTRICT' })
  changeId: string;

  @Column({ name: 'actor_id', type: 'integer', nullable: true })
  actorId: number | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_id', foreignKeyConstraintName: 'change_decisions_actor_id_fkey' })
  actor?: User | null;

  @Column({ type: 'enum', enum: DECISION_ACTIONS, enumName: 'change_decision_action' })
  action: DecisionAction;

  @Column({ name: 'previous_status', type: 'enum', enum: CHANGE_STATUSES, enumName: 'proposal_change_status' })
  previousStatus: ChangeStatus;

  @Column({ name: 'resulting_status', type: 'enum', enum: CHANGE_STATUSES, enumName: 'proposal_change_status' })
  resultingStatus: ChangeStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'observed_version', type: 'bigint', transformer: bigintNumber })
  observedVersion: number;

  /** Null only when an automatic decision closes a microchange whose obsolete payload schema version cannot be read. */
  @Column({ name: 'observed_value', type: 'jsonb', nullable: true })
  observedValue: ValueEnvelope | null;

  @Column({ name: 'decided_at', type: 'timestamptz' })
  decidedAt: Date;
}
