import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { IdentityEntry, identitySchema } from '../catalog-identities/identity.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { SHOWN_IMAGE_DESCRIPTION, ShownImage } from '../images/shown-images';
import { EntryMeta, PartialDate, ToManyLinkage, ToOneLinkage, WITHDRAWN, content, isWithdrawn, partialDate } from '../music/resource-primitives';
import { COUNTRIES } from '../vocabularies/countries';
import { Country } from '../vocabularies/entities/country.entity';
import {
  EVENT_STATUSES,
  EventArtist,
  EventLink,
  EventOrganizer,
  LiveEvent,
  TOUR_STATUSES,
  Tour,
  TourArtist,
  TourLink,
  TourOrganizer,
} from './entities/live-event.entity';

/*
 * The public resources of tours and events. An entry reached as the target of
 * a relationship carries no relations of its own (`undefined`); a withdrawn
 * entry carries none either (`null`) and shows only its notice. The countries
 * and dates of a tour are derived from its published events on each read.
 */

export interface TourDerived {
  /** The countries of its published events, by name. */
  countries: Country[];
  /** The dates of its published events with a date, in order. */
  eventDates: { year: number; month: number | null; day: number | null }[];
}

export interface TourEntry {
  /** With its editorial root. */
  tour: Tour;
  derived: TourDerived;
  /** Its image as the reads show it. */
  image: ShownImage | null;
  relations?: {
    artists: LiveArtistEntry[];
    organizers: OrganizerEntry[];
    links: TourLink[];
    events: EventEntry[];
  } | null;
}

export interface EventEntry {
  /** With its editorial root and its country. */
  event: LiveEvent;
  /** Its image as the reads show it. */
  image: ShownImage | null;
  relations?: {
    tour: TourEntry | null;
    artists: LiveArtistEntry[];
    organizers: OrganizerEntry[];
    links: EventLink[];
    country: Country | null;
  } | null;
}

export interface LiveArtistEntry {
  row: TourArtist | EventArtist;
  artist: ArtistEntry;
}

export interface OrganizerEntry {
  row: TourOrganizer | EventOrganizer;
  identity: IdentityEntry;
}

const liveArtistAttributes = {
  role: ({ row }: LiveArtistEntry) => row.role,
  position: ({ row }: LiveArtistEntry) => row.position,
  creditedAs: ({ row }: LiveArtistEntry) => row.creditedAs,
};
const liveArtistRelationships = { artist: { schema: () => artistSchema, get: ({ artist }: LiveArtistEntry) => artist } };

export const tourArtistSchema: ResourceSchema<LiveArtistEntry> = defineResource({
  type: 'tour-artists',
  id: ({ row }) => String(row.id),
  attributes: liveArtistAttributes,
  relationships: liveArtistRelationships,
});

export const eventArtistSchema: ResourceSchema<LiveArtistEntry> = defineResource({
  type: 'event-artists',
  id: ({ row }) => String(row.id),
  attributes: liveArtistAttributes,
  relationships: liveArtistRelationships,
});

const organizerAttributes = {
  position: ({ row }: OrganizerEntry) => row.position,
  details: ({ row }: OrganizerEntry) => row.details,
};
const organizerRelationships = { identity: { schema: () => identitySchema, get: ({ identity }: OrganizerEntry) => identity } };

export const tourOrganizerSchema: ResourceSchema<OrganizerEntry> = defineResource({
  type: 'tour-organizers',
  id: ({ row }) => String(row.id),
  attributes: organizerAttributes,
  relationships: organizerRelationships,
});

export const eventOrganizerSchema: ResourceSchema<OrganizerEntry> = defineResource({
  type: 'event-organizers',
  id: ({ row }) => String(row.id),
  attributes: organizerAttributes,
  relationships: organizerRelationships,
});

export const tourLinkSchema: ResourceSchema<TourLink> = defineResource({
  type: 'tour-links',
  id: (link) => String(link.id),
  attributes: { label: (link) => link.label, url: (link) => link.url, purpose: (link) => link.purpose, position: (link) => link.position },
  // Null for the general page.
  relationships: { country: { schema: () => COUNTRIES.schema, get: (link) => link.country ?? null } },
});

export const eventLinkSchema: ResourceSchema<EventLink> = defineResource({
  type: 'event-links',
  id: (link) => String(link.id),
  attributes: { label: (link) => link.label, url: (link) => link.url, purpose: (link) => link.purpose, position: (link) => link.position },
});

const tourContent = <V>(read: (entry: TourEntry) => V) => content<TourEntry>(({ tour }) => tour, read);

export const tourSchema: ResourceSchema<TourEntry> = defineResource({
  type: 'tours',
  id: ({ tour }) => tour.publicId,
  attributes: {
    publicationStatus: ({ tour }) => tour.editorialEntity!.publicationStatus,
    withdrawnAt: ({ tour }) => tour.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: tourContent(({ tour }) => tour.title),
    status: tourContent(({ tour }) => tour.status),
    description: tourContent(({ tour }) => tour.description),
    image: tourContent(({ image }) => image),
    startDate: tourContent(({ tour }) => partialDate(tour.startYear, tour.startMonth, tour.startDay)),
    endDate: tourContent(({ tour }) => partialDate(tour.endYear, tour.endMonth, tour.endDay)),
    countries: tourContent(({ derived }) => derived.countries.map(({ code, name }) => ({ code, name }))),
    eventDates: tourContent(({ derived }) => derived.eventDates),
    createdAt: tourContent(({ tour }) => tour.createdAt.toISOString()),
    updatedAt: tourContent(({ tour }) => tour.updatedAt.toISOString()),
  },
  relationships: {
    artists: { schema: () => tourArtistSchema, get: ({ relations }) => relations?.artists },
    organizers: { schema: () => tourOrganizerSchema, get: ({ relations }) => relations?.organizers },
    links: { schema: () => tourLinkSchema, get: ({ relations }) => relations?.links },
    events: { schema: () => eventSchema, get: ({ relations }) => relations?.events },
  },
  meta: ({ tour }) => ({ editorialEntityId: tour.editorialEntityId }),
});

const eventContent = <V>(read: (entry: EventEntry) => V) => content<EventEntry>(({ event }) => event, read);

export const eventSchema: ResourceSchema<EventEntry> = defineResource({
  type: 'events',
  id: ({ event }) => event.publicId,
  attributes: {
    publicationStatus: ({ event }) => event.editorialEntity!.publicationStatus,
    withdrawnAt: ({ event }) => event.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: eventContent(({ event }) => event.title),
    type: eventContent(({ event }) => event.type),
    status: eventContent(({ event }) => event.status),
    description: eventContent(({ event }) => event.description),
    image: eventContent(({ image }) => image),
    startDate: eventContent(({ event }) => partialDate(event.startYear, event.startMonth, event.startDay)),
    startTime: eventContent(({ event }) => event.startTime?.slice(0, 5) ?? null),
    timezone: eventContent(({ event }) => event.timezone),
    city: eventContent(({ event }) => event.city),
    venueName: eventContent(({ event }) => event.venueName),
    createdAt: eventContent(({ event }) => event.createdAt.toISOString()),
    updatedAt: eventContent(({ event }) => event.updatedAt.toISOString()),
  },
  relationships: {
    tour: { schema: () => tourSchema, get: ({ relations }) => (relations ? relations.tour : undefined) },
    artists: { schema: () => eventArtistSchema, get: ({ relations }) => relations?.artists },
    organizers: { schema: () => eventOrganizerSchema, get: ({ relations }) => relations?.organizers },
    links: { schema: () => eventLinkSchema, get: ({ relations }) => relations?.links },
    country: { schema: () => COUNTRIES.schema, get: ({ relations }) => (relations ? relations.country : undefined) },
  },
  meta: ({ event }) => ({ editorialEntityId: event.editorialEntityId }),
});

// Swagger descriptions of the resource objects.

class CountryName {
  @ApiProperty({ example: 'KR' })
  code: string;

  @ApiProperty({ example: 'Corea del Sur' })
  name: string;
}

class TourAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ required: false, example: 'BORN PINK World Tour', description: WITHDRAWN })
  title?: string;

  @ApiProperty({ enum: TOUR_STATUSES, required: false, description: `Estado de negocio, separado del de publicación. ${WITHDRAWN}` })
  status?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  description?: string | null;

  @ApiProperty({ type: ShownImage, nullable: true, required: false, description: `${SHOWN_IMAGE_DESCRIPTION}. ${WITHDRAWN}` })
  image?: ShownImage | null;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Inicio anunciado. ${WITHDRAWN}` })
  startDate?: PartialDate | null;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Fin anunciado. ${WITHDRAWN}` })
  endDate?: PartialDate | null;

  @ApiProperty({ type: [CountryName], required: false, description: `Derivados: países de sus conciertos publicados, por nombre. ${WITHDRAWN}` })
  countries?: CountryName[];

  @ApiProperty({ type: [PartialDate], required: false, description: `Derivadas: fechas de sus conciertos publicados, en orden. ${WITHDRAWN}` })
  eventDates?: PartialDate[];

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class TourRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`tour-artists`, por `position`' })
  artists: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`tour-organizers`, por `position`' })
  organizers: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`tour-links`, por `position`' })
  links: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`events`: sus conciertos publicados, por fecha' })
  events: ToManyLinkage;
}

export class TourResource {
  @ApiProperty({ enum: ['tours'] })
  type: string;

  @ApiProperty({ description: 'public_id del tour' })
  id: string;

  @ApiProperty({ type: TourAttributes })
  attributes: TourAttributes;

  @ApiProperty({ type: TourRelationships, required: false, description: WITHDRAWN })
  relationships?: TourRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class EventAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ required: false, example: 'BORN PINK in Seoul', description: WITHDRAWN })
  title?: string;

  @ApiProperty({ enum: ['concert'], required: false, description: WITHDRAWN })
  type?: string;

  @ApiProperty({
    enum: EVENT_STATUSES,
    required: false,
    description: `Estado de negocio, separado del de publicación; una fecha pasada no lo hace \`performed\`. ${WITHDRAWN}`,
  })
  status?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  description?: string | null;

  @ApiProperty({ type: ShownImage, nullable: true, required: false, description: `${SHOWN_IMAGE_DESCRIPTION}. ${WITHDRAWN}` })
  image?: ShownImage | null;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Fecha parcial. ${WITHDRAWN}` })
  startDate?: PartialDate | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: '19:00', description: `Hora local, HH:MM. ${WITHDRAWN}` })
  startTime?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: 'Asia/Seoul', description: `Zona IANA. ${WITHDRAWN}` })
  timezone?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  city?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  venueName?: string | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class EventRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`tours`, o null' })
  tour: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`event-artists`, por `position`' })
  artists: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`event-organizers`, por `position`; los del tour se muestran aparte' })
  organizers: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`event-links`, por `position`' })
  links: ToManyLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`countries`, o null' })
  country: ToOneLinkage;
}

export class EventResource {
  @ApiProperty({ enum: ['events'] })
  type: string;

  @ApiProperty({ description: 'public_id del concierto' })
  id: string;

  @ApiProperty({ type: EventAttributes })
  attributes: EventAttributes;

  @ApiProperty({ type: EventRelationships, required: false, description: WITHDRAWN })
  relationships?: EventRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}
