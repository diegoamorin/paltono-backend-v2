import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Artist } from '../../catalog-identities/entities/artist.entity';
import { CatalogIdentity } from '../../catalog-identities/entities/catalog-identity.entity';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';
import { Country } from '../../vocabularies/entities/country.entity';

/*
 * The tour and event editorial roots' domain rows, and the artists, organizers
 * and links each one owns. Only applied microchanges write them; the countries
 * and dates of a tour are derived from its published events, never stored.
 */

export const TOUR_STATUSES = ['announced', 'scheduled', 'in_progress', 'postponed', 'cancelled', 'completed'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];
export const EVENT_STATUSES = ['announced', 'scheduled', 'postponed', 'cancelled', 'performed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_TYPES = ['concert'] as const;
export const LIVE_ARTIST_ROLES = ['main', 'support', 'guest'] as const;
export type LiveArtistRole = (typeof LIVE_ARTIST_ROLES)[number];
export const LINK_PURPOSES = ['official', 'tickets'] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;
const urlCheck = (column: string) => `${column} ~* '^https?://[^\\s]+$'`;

// Mirrors the CreateToursAndEvents migration, so `migration:generate` finds no drift.
@Entity('tours')
@Unique('tours_uuid_key', ['uuid'])
@Unique('tours_public_id_key', ['publicId'])
@Unique('tours_editorial_entity_id_key', ['editorialEntityId'])
@Check('tours_title_nonblank', `btrim(title) <> ''`)
@Check('tours_image_url_format', `image_url IS NULL OR ${urlCheck('image_url')}`)
@Check('tours_start_date', partialDateCheck('start'))
@Check('tours_end_date', partialDateCheck('end'))
@Check('tours_scheduled_start', `status <> 'scheduled' OR start_year IS NOT NULL`)
export class Tour {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ type: 'varchar', length: 512 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  /** The announced start and end, partial or unknown; the dates of its concerts are derived from its events. */
  @Column({ name: 'start_year', type: 'smallint', nullable: true })
  startYear: number | null;

  @Column({ name: 'start_month', type: 'smallint', nullable: true })
  startMonth: number | null;

  @Column({ name: 'start_day', type: 'smallint', nullable: true })
  startDay: number | null;

  @Column({ name: 'end_year', type: 'smallint', nullable: true })
  endYear: number | null;

  @Column({ name: 'end_month', type: 'smallint', nullable: true })
  endMonth: number | null;

  @Column({ name: 'end_day', type: 'smallint', nullable: true })
  endDay: number | null;

  /** Its business state, separate from its publication; it never cascades into its events. */
  @Column({ type: 'enum', enum: TOUR_STATUSES, enumName: 'tour_status' })
  status: TourStatus;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'tours_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

/** One concrete concert. */
@Entity('events')
@Unique('events_uuid_key', ['uuid'])
@Unique('events_public_id_key', ['publicId'])
@Unique('events_editorial_entity_id_key', ['editorialEntityId'])
@Index('events_tour_id_idx', ['tourId'])
@Index('events_country_id_idx', ['countryId'])
@Check('events_title_nonblank', `btrim(title) <> ''`)
@Check('events_city_nonblank', `city IS NULL OR btrim(city) <> ''`)
@Check('events_venue_name_nonblank', `venue_name IS NULL OR btrim(venue_name) <> ''`)
@Check('events_image_url_format', `image_url IS NULL OR ${urlCheck('image_url')}`)
@Check('events_start_date', partialDateCheck('start'))
@Check('events_start_time', `start_time IS NULL OR (start_day IS NOT NULL AND timezone IS NOT NULL)`)
@Check('events_scheduled_date', `status <> 'scheduled' OR start_day IS NOT NULL`)
@Check('events_postponed_date', `status <> 'postponed' OR (start_year IS NULL AND start_time IS NULL)`)
export class LiveEvent {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ type: 'varchar', length: 512 })
  title: string;

  @Column({ type: 'enum', enum: EVENT_TYPES, enumName: 'event_type', default: 'concert' })
  type: (typeof EVENT_TYPES)[number];

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'tour_id', type: 'integer', nullable: true })
  tourId: number | null;

  @ManyToOne(() => Tour, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tour_id', foreignKeyConstraintName: 'events_tour_id_fkey' })
  tour?: Tour;

  @Column({ name: 'start_year', type: 'smallint', nullable: true })
  startYear: number | null;

  @Column({ name: 'start_month', type: 'smallint', nullable: true })
  startMonth: number | null;

  @Column({ name: 'start_day', type: 'smallint', nullable: true })
  startDay: number | null;

  /** Local time, `HH:MM:SS`, only with a complete date and its zone. */
  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  /** IANA zone; it may be known without a time and is never inferred from the country. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone: string | null;

  @Column({ name: 'country_id', type: 'integer', nullable: true })
  countryId: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'country_id', foreignKeyConstraintName: 'events_country_id_fkey' })
  country?: Country | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  city: string | null;

  @Column({ name: 'venue_name', type: 'varchar', length: 300, nullable: true })
  venueName: string | null;

  /** Its business state, separate from its publication; a past date does not make it performed. */
  @Column({ type: 'enum', enum: EVENT_STATUSES, enumName: 'event_status' })
  status: EventStatus;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'events_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

/** An artist explicitly announced for a tour; it is not inherited by its concerts. */
@Entity('tour_artists')
@Unique('tour_artists_tour_id_artist_id_key', ['tourId', 'artistId'])
@Index('tour_artists_artist_id_idx', ['artistId'])
@Check('tour_artists_position_nonnegative', `position >= 0`)
@Check('tour_artists_credited_as_nonblank', `credited_as IS NULL OR btrim(credited_as) <> ''`)
export class TourArtist {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'tour_id', type: 'integer' })
  tourId: number;

  @ManyToOne(() => Tour, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tour_id', foreignKeyConstraintName: 'tour_artists_tour_id_fkey' })
  tour?: Tour;

  @Column({ name: 'artist_id', type: 'integer' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'tour_artists_artist_id_fkey' })
  artist?: Artist;

  @Column({ type: 'enum', enum: LIVE_ARTIST_ROLES, enumName: 'live_artist_role' })
  role: LiveArtistRole;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'credited_as', type: 'varchar', length: 200, nullable: true })
  creditedAs: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** An artist explicitly announced for a concert; belonging to its tour confirms nothing. */
@Entity('event_artists')
@Unique('event_artists_event_id_artist_id_key', ['eventId', 'artistId'])
@Index('event_artists_artist_id_idx', ['artistId'])
@Check('event_artists_position_nonnegative', `position >= 0`)
@Check('event_artists_credited_as_nonblank', `credited_as IS NULL OR btrim(credited_as) <> ''`)
export class EventArtist {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'event_id', type: 'integer' })
  eventId: number;

  @ManyToOne(() => LiveEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'event_id', foreignKeyConstraintName: 'event_artists_event_id_fkey' })
  event?: LiveEvent;

  @Column({ name: 'artist_id', type: 'integer' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'event_artists_artist_id_fkey' })
  artist?: Artist;

  @Column({ type: 'enum', enum: LIVE_ARTIST_ROLES, enumName: 'live_artist_role' })
  role: LiveArtistRole;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'credited_as', type: 'varchar', length: 200, nullable: true })
  creditedAs: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** A person or organization credited as organizer of a tour. */
@Entity('tour_organizers')
@Unique('tour_organizers_tour_id_catalog_identity_id_key', ['tourId', 'catalogIdentityId'])
@Index('tour_organizers_catalog_identity_id_idx', ['catalogIdentityId'])
@Check('tour_organizers_position_nonnegative', `position >= 0`)
export class TourOrganizer {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'tour_id', type: 'integer' })
  tourId: number;

  @ManyToOne(() => Tour, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tour_id', foreignKeyConstraintName: 'tour_organizers_tour_id_fkey' })
  tour?: Tour;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'tour_organizers_catalog_identity_id_fkey' })
  identity?: CatalogIdentity;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** A person or organization credited as organizer of a concert; shown apart from its tour's. */
@Entity('event_organizers')
@Unique('event_organizers_event_id_catalog_identity_id_key', ['eventId', 'catalogIdentityId'])
@Index('event_organizers_catalog_identity_id_idx', ['catalogIdentityId'])
@Check('event_organizers_position_nonnegative', `position >= 0`)
export class EventOrganizer {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'event_id', type: 'integer' })
  eventId: number;

  @ManyToOne(() => LiveEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'event_id', foreignKeyConstraintName: 'event_organizers_event_id_fkey' })
  event?: LiveEvent;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'event_organizers_catalog_identity_id_fkey' })
  identity?: CatalogIdentity;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** An external official or ticket page of a tour, general or for one country; never an internal sale. */
@Entity('tour_links')
// UNIQUE NULLS NOT DISTINCT in the migration, which TypeORM cannot declare.
@Unique('tour_links_tour_id_url_country_id_key', ['tourId', 'url', 'countryId'])
@Index('tour_links_country_id_idx', ['countryId'])
@Check('tour_links_label_nonblank', `btrim(label) <> ''`)
@Check('tour_links_url_format', urlCheck('url'))
@Check('tour_links_position_nonnegative', `position >= 0`)
export class TourLink {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'tour_id', type: 'integer' })
  tourId: number;

  @ManyToOne(() => Tour, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tour_id', foreignKeyConstraintName: 'tour_links_tour_id_fkey' })
  tour?: Tour;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'enum', enum: LINK_PURPOSES, enumName: 'live_link_purpose' })
  purpose: LinkPurpose;

  /** The country the page is for; null for the general page. */
  @Column({ name: 'country_id', type: 'integer', nullable: true })
  countryId: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'country_id', foreignKeyConstraintName: 'tour_links_country_id_fkey' })
  country?: Country | null;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** An external official or ticket page of a concert; its country is the concert's. */
@Entity('event_links')
@Unique('event_links_event_id_url_key', ['eventId', 'url'])
@Check('event_links_label_nonblank', `btrim(label) <> ''`)
@Check('event_links_url_format', urlCheck('url'))
@Check('event_links_position_nonnegative', `position >= 0`)
export class EventLink {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'event_id', type: 'integer' })
  eventId: number;

  @ManyToOne(() => LiveEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'event_id', foreignKeyConstraintName: 'event_links_event_id_fkey' })
  event?: LiveEvent;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'enum', enum: LINK_PURPOSES, enumName: 'live_link_purpose' })
  purpose: LinkPurpose;

  @Column({ type: 'smallint', default: 0 })
  position: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
