import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { CatalogIdentity } from '../../catalog-identities/entities/catalog-identity.entity';
import { CONTRIBUTION_ROLE_SCOPES, ContributionRoleScope, ContributionRoleScopeName } from '../../vocabularies/entities/contribution-role.entity';
import { ARTIST_CREDIT_RANKS, ArtistCreditRank, Recording } from './recording.entity';
import { Edition } from './edition.entity';
import { Credit, applyAll, creditChecks, creditJoins } from './work.entity';

/*
 * The rows an edition owns besides its fields: its tracks, with their printed
 * credits, and the credits of the edition. A track has no editorial root of
 * its own; only applied microchanges of its edition write them. A track has
 * no platform links: they are its recording's (ADR 0009).
 */

// Mirrors the CreateTracksAndEditionContributions migration, so `migration:generate` finds no drift.
@Entity('tracks')
@Unique('tracks_edition_id_disc_number_track_number_key', ['editionId', 'discNumber', 'trackNumber'])
@Index('tracks_recording_id_idx', ['recordingId'])
@Check('tracks_position_positive', `disc_number > 0 AND track_number > 0`)
@Check('tracks_title_nonblank', `title IS NULL OR btrim(title) <> ''`)
export class Track {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'edition_id', type: 'integer' })
  editionId: number;

  @ManyToOne(() => Edition, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'edition_id', foreignKeyConstraintName: 'tracks_edition_id_fkey' })
  edition?: Edition;

  @Column({ name: 'recording_id', type: 'integer' })
  recordingId: number;

  @ManyToOne(() => Recording, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recording_id', foreignKeyConstraintName: 'tracks_recording_id_fkey' })
  recording?: Recording;

  @Column({ name: 'disc_number', type: 'smallint' })
  discNumber: number;

  @Column({ name: 'track_number', type: 'smallint' })
  trackNumber: number;

  /** The literal title in this edition; null shows the recording's current title without copying it. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  title: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * An artist a track is presented with: main, featured or remixer, in order.
 * It is a printed credit (ADR 0008): when a track has any, they replace the
 * artist credit of its recording on that track. It credits no authorship nor
 * performance.
 */
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

  @Column({ type: 'enum', enum: ARTIST_CREDIT_RANKS, enumName: 'track_artist_rank' })
  rank: ArtistCreditRank;

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

const editionCreditJoins = creditJoins('edition_contributions');

/** A credit of an edition: mastering, restoration or documented overall production. */
@Entity('edition_contributions')
@Index('edition_contributions_edition_id_idx', ['editionId'])
@Index('edition_contributions_catalog_identity_id_idx', ['catalogIdentityId'])
@applyAll(creditChecks('edition_contributions', 'edition'))
export class EditionContribution extends Credit {
  @Column({ name: 'edition_id', type: 'integer' })
  editionId: number;

  @Column({ name: 'role_scope', type: 'enum', enum: CONTRIBUTION_ROLE_SCOPES, enumName: 'contribution_role_scope', default: 'edition' })
  roleScope: ContributionRoleScopeName;

  @ManyToOne(() => Edition, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'edition_id', foreignKeyConstraintName: 'edition_contributions_edition_id_fkey' })
  edition?: Edition;

  @applyAll(editionCreditJoins.identity)
  identity?: CatalogIdentity;

  @applyAll(editionCreditJoins.role)
  roleInScope?: ContributionRoleScope;
}
