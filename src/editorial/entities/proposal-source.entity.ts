import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { ChangeProposal } from './change-proposal.entity';

/** General evidence for a whole proposal: a web address, a bibliographic citation or both. */
@Entity('proposal_sources')
@Unique('proposal_sources_proposal_id_id_key', ['proposalId', 'id'])
@Check(
  'proposal_sources_reference',
  `(url IS NOT NULL AND btrim(url) <> '') OR (citation_text IS NOT NULL AND btrim(citation_text) <> '')`,
)
@Check('proposal_sources_url_format', `url IS NULL OR url ~* '^https?://[^\\s]+$'`)
export class ProposalSource {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId: string;

  @ManyToOne(() => ChangeProposal, (proposal) => proposal.sources, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'proposal_id', foreignKeyConstraintName: 'proposal_sources_proposal_id_fkey' })
  proposal?: ChangeProposal;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'citation_text', type: 'text', nullable: true })
  citationText: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
