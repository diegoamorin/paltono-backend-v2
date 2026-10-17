import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { ChangeProposal } from './change-proposal.entity';
import { bigintNumber } from './bigint-number';
import { EditorialEntity } from './editorial-entity.entity';

export const CHANGE_OPERATIONS = [
  'create_entity',
  'set_fields',
  'add_relation',
  'update_relation',
  'remove_relation',
  'withdraw_entity',
] as const;
export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export const CHANGE_STATUSES = ['pending', 'conflicted', 'applied', 'rejected', 'satisfied', 'blocked', 'withdrawn'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/**
 * A value as microchanges, decisions and revisions store it: `exists` tells an
 * absent row or field apart from one whose value is null.
 */
export type ValueEnvelope = { exists: true; value: object | string | number | boolean | null } | { exists: false };

/** A microchange: one allow-listed operation on the data an editorial root owns. */
@Entity('proposal_changes')
@Unique('proposal_changes_proposal_id_id_key', ['proposalId', 'id'])
@Unique('proposal_changes_id_entity_id_key', ['id', 'entityId'])
@Unique('proposal_changes_proposal_id_position_key', ['proposalId', 'position'])
@Index('proposal_changes_proposal_id_status_idx', ['proposalId', 'status'])
@Index('proposal_changes_entity_id_target_path_status_idx', ['entityId', 'targetPath', 'status'])
@Check('proposal_changes_base_version_nonnegative', `base_version >= 0`)
@Check('proposal_changes_payload_schema_version_positive', `payload_schema_version > 0`)
@Check('proposal_changes_position_nonnegative', `position >= 0`)
@Check('proposal_changes_base_value_envelope', `jsonb_typeof(base_value -> 'exists') = 'boolean'`)
@Check('proposal_changes_proposed_value_envelope', `jsonb_typeof(proposed_value -> 'exists') = 'boolean'`)
@Check('proposal_changes_resolution', `(status IN ('pending', 'conflicted')) = (resolved_at IS NULL)`)
export class ProposalChange {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId: string;

  @ManyToOne(() => ChangeProposal, (proposal) => proposal.changes, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'proposal_id', foreignKeyConstraintName: 'proposal_changes_proposal_id_fkey' })
  proposal?: ChangeProposal;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entity_id', foreignKeyConstraintName: 'proposal_changes_entity_id_fkey' })
  entity?: EditorialEntity;

  @Column({ type: 'enum', enum: CHANGE_OPERATIONS, enumName: 'proposal_change_operation' })
  operation: ChangeOperation;

  @Column({ name: 'target_path', type: 'varchar', length: 100 })
  targetPath: string;

  @Column({ name: 'target_key', type: 'jsonb', nullable: true })
  targetKey: object | null;

  @Column({ name: 'base_version', type: 'bigint', transformer: bigintNumber })
  baseVersion: number;

  @Column({ name: 'base_value', type: 'jsonb' })
  baseValue: ValueEnvelope;

  @Column({ name: 'proposed_value', type: 'jsonb' })
  proposedValue: ValueEnvelope;

  @Column({ name: 'payload_schema_version', type: 'smallint', default: 1 })
  payloadSchemaVersion: number;

  @Column({ name: 'atomic_group_id', type: 'uuid', nullable: true })
  atomicGroupId: string | null;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'enum', enum: CHANGE_STATUSES, enumName: 'proposal_change_status', default: 'pending' })
  status: ChangeStatus;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /** The microchanges of the proposal it depends on, when loaded; not a column. */
  dependsOnIds?: string[];

  /** The general sources of the proposal linked to it, when loaded; not a column. */
  sourceIds?: string[];
}
