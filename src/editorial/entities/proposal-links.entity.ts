import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ProposalChange } from './proposal-change.entity';
import { ProposalSource } from './proposal-source.entity';

/*
 * Links between the rows of one proposal. Their composite foreign keys repeat
 * `proposal_id` on both sides, so neither a dependency nor a source can point
 * into another proposal.
 */

/** A microchange that needs another one of its proposal first. */
@Entity('change_dependencies')
@Index('change_dependencies_depends_on_change_id_idx', ['dependsOnChangeId'])
@ForeignKey(() => ProposalChange, ['proposal_id', 'change_id'], ['proposal_id', 'id'], {
  name: 'change_dependencies_change_fkey',
  onDelete: 'RESTRICT',
})
@ForeignKey(() => ProposalChange, ['proposal_id', 'depends_on_change_id'], ['proposal_id', 'id'], {
  name: 'change_dependencies_depends_on_change_fkey',
  onDelete: 'RESTRICT',
})
@Check('change_dependencies_not_self', `change_id <> depends_on_change_id`)
export class ChangeDependency {
  @PrimaryColumn({ name: 'change_id', type: 'uuid', primaryKeyConstraintName: 'change_dependencies_pkey' })
  changeId: string;

  @PrimaryColumn({ name: 'depends_on_change_id', type: 'uuid', primaryKeyConstraintName: 'change_dependencies_pkey' })
  dependsOnChangeId: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId: string;
}

/** A general source of a proposal that backs one of its microchanges in particular. */
@Entity('change_sources')
@Index('change_sources_source_id_idx', ['sourceId'])
@ForeignKey(() => ProposalChange, ['proposal_id', 'change_id'], ['proposal_id', 'id'], {
  name: 'change_sources_change_fkey',
  onDelete: 'RESTRICT',
})
@ForeignKey(() => ProposalSource, ['proposal_id', 'source_id'], ['proposal_id', 'id'], {
  name: 'change_sources_source_fkey',
  onDelete: 'RESTRICT',
})
export class ChangeSource {
  @PrimaryColumn({ name: 'change_id', type: 'uuid', primaryKeyConstraintName: 'change_sources_pkey' })
  changeId: string;

  @PrimaryColumn({ name: 'source_id', type: 'uuid', primaryKeyConstraintName: 'change_sources_pkey' })
  sourceId: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId: string;
}
