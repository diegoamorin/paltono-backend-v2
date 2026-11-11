import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';

/*
 * The release group editorial root's domain row, and the artist credits a
 * release group owns. Only applied microchanges write them; a release
 * group's date and upcoming state are derived from its editions, never
 * stored.
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

/** An artist a release group is presented with, in order; it applies to all its editions. */
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
