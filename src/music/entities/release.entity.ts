import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';

/*
 * The release group and release editorial roots' domain rows, and the
 * presentation credits a release group owns. Only applied microchanges write
 * them; a release group's date and upcoming state are derived from its
 * releases, never stored.
 */

export const RELEASE_GROUP_TYPES = ['album', 'ep', 'single', 'compilation'] as const;
export type ReleaseGroupType = (typeof RELEASE_GROUP_TYPES)[number];

// Mirrors the CreateReleaseGroupsAndReleases migration, so `migration:generate` finds no drift.
@Entity('release_groups')
@Unique('release_groups_uuid_key', ['uuid'])
@Unique('release_groups_public_id_key', ['publicId'])
@Unique('release_groups_editorial_entity_id_key', ['editorialEntityId'])
@Index('release_groups_repackage_of_id_idx', ['repackageOfId'])
@Check('release_groups_title_nonblank', `btrim(title) <> ''`)
@Check('release_groups_repackage_not_self', `repackage_of_id <> id`)
export class ReleaseGroup {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ type: 'varchar', length: 512 })
  title: string;

  /** As its artist or agency announced it; never derived from the tracks. */
  @Column({ type: 'enum', enum: RELEASE_GROUP_TYPES, enumName: 'release_group_type' })
  type: ReleaseGroupType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** The original release group this repackage relaunches. */
  @Column({ name: 'repackage_of_id', type: 'integer', nullable: true })
  repackageOfId: number | null;

  @ManyToOne(() => ReleaseGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'repackage_of_id', foreignKeyConstraintName: 'release_groups_repackage_of_id_fkey' })
  repackageOf?: ReleaseGroup;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'release_groups_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

/** An artist a release group is presented with, in order; it applies to all its releases. */
@Entity('release_artist_credits')
@Index('release_artist_credits_release_group_id_idx', ['releaseGroupId'])
@Check('release_artist_credits_position_nonnegative', `position >= 0`)
@Check('release_artist_credits_credited_as_nonblank', `credited_as IS NULL OR btrim(credited_as) <> ''`)
export class ReleaseArtistCredit {
  @PrimaryColumn({ name: 'artist_id', type: 'integer', primaryKeyConstraintName: 'release_artist_credits_pkey' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'release_artist_credits_artist_id_fkey' })
  artist?: Artist;

  @PrimaryColumn({ name: 'release_group_id', type: 'integer', primaryKeyConstraintName: 'release_artist_credits_pkey' })
  releaseGroupId: number;

  @ManyToOne(() => ReleaseGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_group_id', foreignKeyConstraintName: 'release_artist_credits_release_group_id_fkey' })
  releaseGroup?: ReleaseGroup;

  @Column({ type: 'integer' })
  position: number;

  /** The literal name in the source; null shows the identity's display name. */
  @Column({ name: 'credited_as', type: 'varchar', length: 200, nullable: true })
  creditedAs: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** One concrete digital publication of a release group. */
@Entity('releases')
@Unique('releases_uuid_key', ['uuid'])
@Unique('releases_public_id_key', ['publicId'])
@Unique('releases_editorial_entity_id_key', ['editorialEntityId'])
// UNIQUE NULLS NOT DISTINCT in the migration, which TypeORM cannot declare.
@Unique('releases_release_group_id_edition_name_key', ['releaseGroupId', 'editionName'])
@Check('releases_title_nonblank', `title IS NULL OR btrim(title) <> ''`)
@Check('releases_edition_name_nonblank', `edition_name IS NULL OR btrim(edition_name) <> ''`)
@Check(
  'releases_release_date',
  `(release_year IS NULL OR release_year BETWEEN 1 AND 9999) AND (release_month IS NULL OR (release_year IS NOT NULL AND release_month BETWEEN 1 AND 12)) AND (release_day IS NULL OR (release_month IS NOT NULL AND release_day BETWEEN 1 AND extract(day FROM make_date(release_year, release_month, 1) + interval '1 month - 1 day')))`,
)
@Check(
  'releases_release_time',
  `(release_time IS NULL AND timezone IS NULL) OR (release_time IS NOT NULL AND timezone IS NOT NULL AND release_day IS NOT NULL)`,
)
@Check('releases_cover_art_url_format', `cover_art_url IS NULL OR cover_art_url ~* '^https?://[^\\s]+$'`)
export class Release {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ name: 'release_group_id', type: 'integer' })
  releaseGroupId: number;

  @ManyToOne(() => ReleaseGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_group_id', foreignKeyConstraintName: 'releases_release_group_id_fkey' })
  releaseGroup?: ReleaseGroup;

  /** The literal title of this release; null shows the release group's without copying it. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  title: string | null;

  /** Deluxe, Sped Up, Japan Edition…; null for the standard release. */
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
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'releases_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}
