import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';

/*
 * The release editorial root's domain row, and the artist credits a release
 * owns. Only applied microchanges write them; a release's date and upcoming
 * state are derived from its editions, never stored.
 */

export const RELEASE_TYPES = ['album', 'ep', 'single', 'compilation'] as const;
export type ReleaseType = (typeof RELEASE_TYPES)[number];

// Mirrors the CreateReleasesAndEditions migration, so `migration:generate` finds no drift.
@Entity('releases')
@Unique('releases_uuid_key', ['uuid'])
@Unique('releases_public_id_key', ['publicId'])
@Unique('releases_editorial_entity_id_key', ['editorialEntityId'])
@Index('releases_repackage_of_id_idx', ['repackageOfId'])
@Check('releases_title_nonblank', `btrim(title) <> ''`)
@Check('releases_repackage_not_self', `repackage_of_id <> id`)
export class Release {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ type: 'varchar', length: 512 })
  title: string;

  /** As its artist or agency announced it; never derived from the tracks. */
  @Column({ type: 'enum', enum: RELEASE_TYPES, enumName: 'release_type' })
  type: ReleaseType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** The original release this repackage relaunches. */
  @Column({ name: 'repackage_of_id', type: 'integer', nullable: true })
  repackageOfId: number | null;

  @ManyToOne(() => Release, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'repackage_of_id', foreignKeyConstraintName: 'releases_repackage_of_id_fkey' })
  repackageOf?: Release;

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

/** An artist a release is presented with, in order; it applies to all its editions. */
@Entity('release_artist_credits')
@Index('release_artist_credits_release_id_idx', ['releaseId'])
@Check('release_artist_credits_position_nonnegative', `position >= 0`)
@Check('release_artist_credits_credited_as_nonblank', `credited_as IS NULL OR btrim(credited_as) <> ''`)
export class ReleaseArtistCredit {
  @PrimaryColumn({ name: 'artist_id', type: 'integer', primaryKeyConstraintName: 'release_artist_credits_pkey' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'release_artist_credits_artist_id_fkey' })
  artist?: Artist;

  @PrimaryColumn({ name: 'release_id', type: 'integer', primaryKeyConstraintName: 'release_artist_credits_pkey' })
  releaseId: number;

  @ManyToOne(() => Release, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_id', foreignKeyConstraintName: 'release_artist_credits_release_id_fkey' })
  release?: Release;

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
