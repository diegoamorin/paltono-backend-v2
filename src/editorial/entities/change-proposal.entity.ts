import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { User } from '../../accounts/entities/user.entity';
import { ProposalChange } from './proposal-change.entity';
import { ProposalSource } from './proposal-source.entity';

export const PROPOSAL_STATUSES = ['draft', 'open', 'closed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * A proposal: a private draft until its author submits it, then a frozen
 * submission that stays open while any of its microchanges is unresolved.
 */
@Entity('change_proposals')
@Index('change_proposals_author_id_created_at_idx', ['authorId', 'createdAt'])
@Index('change_proposals_status_submitted_at_idx', ['status', 'submittedAt'])
@Index('change_proposals_previous_proposal_id_idx', ['previousProposalId'])
@Check('change_proposals_not_own_predecessor', `previous_proposal_id <> id`)
@Check('change_proposals_description_nonblank', `status = 'draft' OR btrim(description) <> ''`)
@Check(
  'change_proposals_lifecycle',
  `(status = 'draft' AND submitted_at IS NULL AND closed_at IS NULL) OR (status = 'open' AND submitted_at IS NOT NULL AND closed_at IS NULL) OR (status = 'closed' AND submitted_at IS NOT NULL AND closed_at IS NOT NULL)`,
)
export class ChangeProposal {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'author_id', type: 'integer' })
  authorId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id', foreignKeyConstraintName: 'change_proposals_author_id_fkey' })
  author?: User;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: PROPOSAL_STATUSES, enumName: 'change_proposal_status', default: 'draft' })
  status: ProposalStatus;

  @Column({ name: 'previous_proposal_id', type: 'uuid', nullable: true })
  previousProposalId: string | null;

  @ManyToOne(() => ChangeProposal, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'previous_proposal_id', foreignKeyConstraintName: 'change_proposals_previous_proposal_id_fkey' })
  previousProposal?: ChangeProposal | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @OneToMany(() => ProposalChange, (change) => change.proposal)
  changes?: ProposalChange[];

  @OneToMany(() => ProposalSource, (source) => source.proposal)
  sources?: ProposalSource[];
}
