import { Check, Column, Entity, ForeignKey, PrimaryColumn, Unique } from 'typeorm';
import { ChangeDecision } from './change-decision.entity';
import { bigintNumber } from './bigint-number';
import { EditorialEntity } from './editorial-entity.entity';
import { ProposalChange, ValueEnvelope } from './proposal-change.entity';

/** Append-only record of a microchange incorporated into its root, with the values it replaced. */
@Entity('entity_revisions')
@Unique('entity_revisions_entity_id_version_key', ['entityId', 'version'])
@Unique('entity_revisions_change_id_key', ['changeId'])
@Unique('entity_revisions_decision_id_key', ['decisionId'])
@ForeignKey(() => ProposalChange, ['change_id', 'entity_id'], ['id', 'entity_id'], {
  name: 'entity_revisions_change_fkey',
  onDelete: 'RESTRICT',
})
@ForeignKey(() => ChangeDecision, ['decision_id', 'change_id'], ['id', 'change_id'], {
  name: 'entity_revisions_decision_fkey',
  onDelete: 'RESTRICT',
})
@Check('entity_revisions_version_positive', `version > 0`)
@Check('entity_revisions_before_value_envelope', `jsonb_typeof(before_value -> 'exists') = 'boolean'`)
@Check('entity_revisions_after_value_envelope', `jsonb_typeof(after_value -> 'exists') = 'boolean'`)
export class EntityRevision {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  @ForeignKey(() => EditorialEntity, { name: 'entity_revisions_entity_id_fkey', onDelete: 'RESTRICT' })
  entityId: string;

  @Column({ type: 'bigint', transformer: bigintNumber })
  version: number;

  @Column({ name: 'change_id', type: 'uuid' })
  changeId: string;

  @Column({ name: 'decision_id', type: 'uuid' })
  decisionId: string;

  @Column({ name: 'before_value', type: 'jsonb' })
  beforeValue: ValueEnvelope;

  @Column({ name: 'after_value', type: 'jsonb' })
  afterValue: ValueEnvelope;

  @Column({ name: 'result_key', type: 'jsonb', nullable: true })
  resultKey: object | null;

  @Column({ name: 'applied_at', type: 'timestamptz' })
  appliedAt: Date;
}
