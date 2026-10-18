import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { CatalogIdentity } from '../../catalog-identities/entities/catalog-identity.entity';
import { CONTRIBUTION_ROLE_SCOPES, ContributionRoleScope, ContributionRoleScopeName } from '../../vocabularies/entities/contribution-role.entity';
import { Platform } from '../../vocabularies/entities/platform.entity';
import { Recording } from './recording.entity';
import { Release } from './release.entity';
import { Credit, applyAll, creditChecks, creditJoins } from './work.entity';

/*
 * The rows a release owns besides its fields: its tracks, with their
 * presentation credits and platform links, and the credits of the release.
 * A track has no editorial root of its own; only applied microchanges of its
 * release write them.
 */

export const TRACK_ARTIST_RANKS = ['main', 'featured', 'remixer'] as const;
export type TrackArtistRank = (typeof TRACK_ARTIST_RANKS)[number];

// Mirrors the CreateTracksAndReleaseContributions migration, so `migration:generate` finds no drift.
@Entity('tracks')
@Unique('tracks_release_id_disc_number_track_number_key', ['releaseId', 'discNumber', 'trackNumber'])
@Index('tracks_recording_id_idx', ['recordingId'])
@Check('tracks_position_positive', `disc_number > 0 AND track_number > 0`)
@Check('tracks_title_nonblank', `title IS NULL OR btrim(title) <> ''`)
export class Track {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'release_id', type: 'integer' })
  releaseId: number;

  @ManyToOne(() => Release, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_id', foreignKeyConstraintName: 'tracks_release_id_fkey' })
  release?: Release;

  @Column({ name: 'recording_id', type: 'integer' })
  recordingId: number;

  @ManyToOne(() => Recording, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recording_id', foreignKeyConstraintName: 'tracks_recording_id_fkey' })
  recording?: Recording;

  @Column({ name: 'disc_number', type: 'smallint' })
  discNumber: number;

  @Column({ name: 'track_number', type: 'smallint' })
  trackNumber: number;

  /** The literal title in this release; null shows the recording's current title without copying it. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  title: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** An artist a track is presented with: main, featured or remixer, in order. It credits no authorship nor performance. */
@Entity('track_artist_credits')
@Index('track_artist_credits_track_id_idx', ['trackId'])
@Check('track_artist_credits_position_nonnegative', `position >= 0`)
@Check('track_artist_credits_credited_as_nonblank', `credited_as IS NULL OR btrim(credited_as) <> ''`)
export class TrackArtistCredit {
  @PrimaryColumn({ name: 'artist_id', type: 'integer', primaryKeyConstraintName: 'track_artist_credits_pkey' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'track_artist_credits_artist_id_fkey' })
  artist?: Artist;

  @PrimaryColumn({ name: 'track_id', type: 'integer', primaryKeyConstraintName: 'track_artist_credits_pkey' })
  trackId: number;

  @ManyToOne(() => Track, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'track_id', foreignKeyConstraintName: 'track_artist_credits_track_id_fkey' })
  track?: Track;

  @Column({ type: 'enum', enum: TRACK_ARTIST_RANKS, enumName: 'track_artist_rank' })
  rank: TrackArtistRank;

  @Column({ type: 'smallint' })
  position: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** The literal name in the source; null shows the identity's display name. */
  @Column({ name: 'credited_as', type: 'varchar', length: 200, nullable: true })
  creditedAs: string | null;
}

/** A link of a track on a platform that supports tracks. */
@Entity('track_platform_links')
@Unique('track_platform_links_track_platform_url_key', ['trackId', 'platformId', 'url'])
@Index('track_platform_links_platform_id_idx', ['platformId'])
@Check('track_platform_links_url_format', `url ~* '^https?://[^\\s]+$'`)
export class TrackPlatformLink {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'platform_id', type: 'integer' })
  platformId: number;

  @ManyToOne(() => Platform, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platform_id', foreignKeyConstraintName: 'track_platform_links_platform_id_fkey' })
  platform?: Platform;

  @Column({ name: 'track_id', type: 'integer' })
  trackId: number;

  @ManyToOne(() => Track, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'track_id', foreignKeyConstraintName: 'track_platform_links_track_id_fkey' })
  track?: Track;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

const releaseCreditJoins = creditJoins('release_contributions');

/** A credit of a release: mastering, restoration or documented overall production. */
@Entity('release_contributions')
@Index('release_contributions_release_id_idx', ['releaseId'])
@Index('release_contributions_catalog_identity_id_idx', ['catalogIdentityId'])
@applyAll(creditChecks('release_contributions', 'release'))
export class ReleaseContribution extends Credit {
  @Column({ name: 'release_id', type: 'integer' })
  releaseId: number;

  @Column({ name: 'role_scope', type: 'enum', enum: CONTRIBUTION_ROLE_SCOPES, enumName: 'contribution_role_scope', default: 'release' })
  roleScope: ContributionRoleScopeName;

  @ManyToOne(() => Release, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'release_id', foreignKeyConstraintName: 'release_contributions_release_id_fkey' })
  release?: Release;

  @applyAll(releaseCreditJoins.identity)
  identity?: CatalogIdentity;

  @applyAll(releaseCreditJoins.role)
  roleInScope?: ContributionRoleScope;
}
