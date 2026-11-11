import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { partialDateCheck } from '../../common/partial-date/partial-date';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';
import { ReleaseGroup } from './release.entity';

/** One concrete digital publication of a release group. Only applied microchanges write it. */
// Mirrors the CreateReleaseGroupsAndReleases migration, so `migration:generate` finds no drift.
@Entity('editions')
@Unique('editions_uuid_key', ['uuid'])
@Unique('editions_public_id_key', ['publicId'])
@Unique('editions_editorial_entity_id_key', ['editorialEntityId'])
// UNIQUE NULLS NOT DISTINCT in the migration, which TypeORM cannot declare.
@Unique('editions_release_group_id_edition_name_key', ['releaseGroupId', 'editionName'])
@Check('editions_title_nonblank', `title IS NULL OR btrim(title) <> ''`)
@Check('editions_edition_name_nonblank', `edition_name IS NULL OR btrim(edition_name) <> ''`)
@Check('editions_release_date', partialDateCheck('release'))
@Check(
  'editions_release_time',
  `(release_time IS NULL AND timezone IS NULL) OR (release_time IS NOT NULL AND timezone IS NOT NULL AND release_day IS NOT NULL)`,
)
@Check('editions_cover_art_url_format', `cover_art_url IS NULL OR cover_art_url ~* '^https?://[^\\s]+$'`)
export class Edition {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ name: 'release_group_id', type: 'integer' })
  releaseGroupId: number;

  @ManyToOne(() => ReleaseGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_group_id', foreignKeyConstraintName: 'editions_release_group_id_fkey' })
  releaseGroup?: ReleaseGroup;

  /** The literal title of this edition; null shows the release group's without copying it. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  title: string | null;

  /** Deluxe, Sped Up, Japan Edition…; null for the standard edition. */
  @Column({ name: 'edition_name', type: 'varchar', length: 200, nullable: true })
  editionName: string | null;

  @Column({ name: 'release_year', type: 'smallint', nullable: true })
  releaseYear: number | null;

  @Column({ name: 'release_month', type: 'smallint', nullable: true })
  releaseMonth: number | null;

  @Column({ name: 'release_day', type: 'smallint', nullable: true })
  releaseDay: number | null;

  /** Local announced time, `HH:MM:SS`, with its IANA zone. */
  @Column({ name: 'release_time', type: 'time', nullable: true })
  releaseTime: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone: string | null;

  @Column({ name: 'cover_art_url', type: 'varchar', length: 2048, nullable: true })
  coverArtUrl: string | null;

  @Column({ name: 'is_cancelled', type: 'boolean', default: false })
  isCancelled: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'editions_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}
