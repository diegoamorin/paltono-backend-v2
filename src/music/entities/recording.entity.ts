import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';
import { CONTRIBUTION_ROLE_SCOPES, ContributionRoleScopeName } from '../../vocabularies/entities/contribution-role.entity';
import { Genre } from '../../vocabularies/entities/genre.entity';
import { CatalogIdentity } from '../../catalog-identities/entities/catalog-identity.entity';
import { ContributionRoleScope } from '../../vocabularies/entities/contribution-role.entity';
import { Credit, Work, applyAll, creditChecks, creditJoins } from './work.entity';

/*
 * The recording editorial root's domain rows and the rows it owns: its
 * credits, genres and the works it relates to. Only applied microchanges
 * write them.
 */

export const RECORDING_WORK_RELATION_TYPES = ['performance', 'interpolation', 'sample'] as const;
export type RecordingWorkRelationType = (typeof RECORDING_WORK_RELATION_TYPES)[number];

// Mirrors the CreateWorksAndRecordings migration, so `migration:generate` finds no drift.
@Entity('recordings')
@Unique('recordings_uuid_key', ['uuid'])
@Unique('recordings_public_id_key', ['publicId'])
@Unique('recordings_editorial_entity_id_key', ['editorialEntityId'])
@Check('recordings_title_nonblank', `btrim(title) <> ''`)
@Check('recordings_isrc_format', `isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'`)
@Check(
  'recordings_recording_date',
  `(recording_year IS NULL OR recording_year BETWEEN 1 AND 9999) AND (recording_month IS NULL OR (recording_year IS NOT NULL AND recording_month BETWEEN 1 AND 12)) AND (recording_day IS NULL OR (recording_month IS NOT NULL AND recording_day BETWEEN 1 AND extract(day FROM make_date(recording_year, recording_month, 1) + interval '1 month - 1 day')))`,
)
export class Recording {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ name: 'desc', type: 'text', nullable: true })
  description: string | null;

  /** A clean version is another recording. */
  @Column({ name: 'is_explicit', type: 'boolean', default: false })
  isExplicit: boolean;

  /** Canonical ISRC, without hyphens. */
  @Column({ type: 'char', length: 12, nullable: true })
  isrc: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'recording_year', type: 'smallint', nullable: true })
  recordingYear: number | null;

  @Column({ name: 'recording_month', type: 'smallint', nullable: true })
  recordingMonth: number | null;

  @Column({ name: 'recording_day', type: 'smallint', nullable: true })
  recordingDay: number | null;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'recordings_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

const recordingCreditJoins = creditJoins('recording_contributions');

@Entity('recording_contributions')
@Index('recording_contributions_recording_id_idx', ['recordingId'])
@Index('recording_contributions_catalog_identity_id_idx', ['catalogIdentityId'])
@applyAll(creditChecks('recording_contributions', 'recording'))
export class RecordingContribution extends Credit {
  @Column({ name: 'recording_id', type: 'integer' })
  recordingId: number;

  @Column({ name: 'role_scope', type: 'enum', enum: CONTRIBUTION_ROLE_SCOPES, enumName: 'contribution_role_scope', default: 'recording' })
  roleScope: ContributionRoleScopeName;

  @ManyToOne(() => Recording, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recording_id', foreignKeyConstraintName: 'recording_contributions_recording_id_fkey' })
  recording?: Recording;

  @applyAll(recordingCreditJoins.identity)
  identity?: CatalogIdentity;

  @applyAll(recordingCreditJoins.role)
  roleInScope?: ContributionRoleScope;
}

/** A work a recording performs, interpolates or samples; `position` orders the works of a medley. */
@Entity('recording_works')
@Unique('recording_works_recording_id_work_id_relation_type_key', ['recordingId', 'workId', 'relationType'])
@Index('recording_works_work_id_idx', ['workId'])
@Check('recording_works_position_positive', `position IS NULL OR position > 0`)
@Check('recording_works_source_url_format', `source_url IS NULL OR source_url ~* '^https?://[^\\s]+$'`)
export class RecordingWork {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'recording_id', type: 'integer' })
  recordingId: number;

  @ManyToOne(() => Recording, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recording_id', foreignKeyConstraintName: 'recording_works_recording_id_fkey' })
  recording?: Recording;

  @Column({ name: 'work_id', type: 'bigint' })
  workId: string;

  @ManyToOne(() => Work, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'work_id', foreignKeyConstraintName: 'recording_works_work_id_fkey' })
  work?: Work;

  @Column({ name: 'relation_type', type: 'enum', enum: RECORDING_WORK_RELATION_TYPES, enumName: 'recording_work_relation_type', default: 'performance' })
  relationType: RecordingWorkRelationType;

  @Column({ type: 'smallint', nullable: true })
  position: number | null;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ name: 'source_text', type: 'text', nullable: true })
  sourceText: string | null;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** A genre of a recording; at most one is its primary genre. */
@Entity('recording_genres')
@Index('recording_genres_primary_key', ['recordingId'], { unique: true, where: 'is_primary' })
@Index('recording_genres_genre_id_idx', ['genreId'])
export class RecordingGenre {
  @PrimaryColumn({ name: 'recording_id', type: 'integer', primaryKeyConstraintName: 'recording_genres_pkey' })
  recordingId: number;

  @ManyToOne(() => Recording, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recording_id', foreignKeyConstraintName: 'recording_genres_recording_id_fkey' })
  recording?: Recording;

  @PrimaryColumn({ name: 'genre_id', type: 'integer', primaryKeyConstraintName: 'recording_genres_pkey' })
  genreId: number;

  @ManyToOne(() => Genre, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'genre_id', foreignKeyConstraintName: 'recording_genres_genre_id_fkey' })
  genre?: Genre;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
