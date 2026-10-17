import { Check, Column, Entity, ForeignKey, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { User } from '../../accounts/entities/user.entity';
import { bigintNumber } from './bigint-number';
import { ProposalChange } from './proposal-change.entity';

export const EDITORIAL_ENTITY_TYPES = ['identity', 'work', 'recording', 'release_group', 'release', 'event', 'tour'] as const;
export type EditorialEntityType = (typeof EDITORIAL_ENTITY_TYPES)[number];
export const PUBLICATION_STATUSES = ['reserved', 'published', 'withdrawn'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

// Mirrors the CreateEditorialContributions migration, so `migration:generate` finds no drift.
@Entity('editorial_entities')
@Unique('editorial_entities_creation_change_id_key', ['creationChangeId'])
@Index('editorial_entities_created_by_idx', ['createdById'])
@ForeignKey(() => ProposalChange, ['creation_change_id', 'id'], ['id', 'entity_id'], {
  name: 'editorial_entities_creation_change_fkey',
  onDelete: 'RESTRICT',
})
@Check('editorial_entities_current_version_nonnegative', `current_version >= 0`)
@Check(
  'editorial_entities_publication',
  `(publication_status = 'reserved' AND current_version = 0 AND creation_change_id IS NULL AND published_at IS NULL AND withdrawn_at IS NULL) OR (publication_status = 'published' AND current_version >= 1 AND creation_change_id IS NOT NULL AND published_at IS NOT NULL AND withdrawn_at IS NULL) OR (publication_status = 'withdrawn' AND current_version >= 1 AND creation_change_id IS NOT NULL AND published_at IS NOT NULL AND withdrawn_at IS NOT NULL)`,
)
export class EditorialEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'entity_type', type: 'enum', enum: EDITORIAL_ENTITY_TYPES, enumName: 'editorial_entity_type' })
  entityType: EditorialEntityType;

  @Column({
    name: 'publication_status',
    type: 'enum',
    enum: PUBLICATION_STATUSES,
    enumName: 'editorial_publication_status',
    default: 'reserved',
  })
  publicationStatus: PublicationStatus;

  /** The reservation's author, who must also author the applied creation. */
  @Column({ name: 'created_by', type: 'integer' })
  createdById: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'editorial_entities_created_by_fkey' })
  createdBy?: User;

  @Column({ name: 'current_version', type: 'bigint', default: 0, transformer: bigintNumber })
  currentVersion: number;

  @Column({ name: 'creation_change_id', type: 'uuid', nullable: true })
  creationChangeId: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true })
  withdrawnAt: Date | null;
}
