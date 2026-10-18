import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { newPublicId } from '../catalog-identities/identity-creations';
import { PartialDateValue } from '../music/recordings';
import {
  EventArtist,
  EventLink,
  EventOrganizer,
  EventStatus,
  LinkPurpose,
  LiveArtistRole,
  LiveEvent,
  Tour,
  TourArtist,
  TourLink,
  TourOrganizer,
  TourStatus,
} from './entities/live-event.entity';

/*
 * The writes of tours, events and the artists, organizers and links each one
 * owns. The editorial flow calls them inside the transaction that applies a
 * microchange, once it holds the locks of every root involved. Another root is
 * named by its editorial UUID, as `{"entity_id": …}`, since its domain ids are
 * not public.
 */

export interface RootReference {
  entity_id: string;
}

/** When and in which state a tour is, as announced: partial dates, never a list of its concerts. */
export interface TourScheduleValue {
  status: TourStatus;
  startDate: PartialDateValue | null;
  endDate: PartialDateValue | null;
}

/** A tour as its creation proposes it and its revisions record it. */
export interface TourValue extends Partial<Omit<TourScheduleValue, 'status'>> {
  title: string;
  status: TourStatus;
  description?: string | null;
  imageUrl?: string | null;
}

export const TOUR_FIELDS = {
  'tours.title': 'title',
  'tours.description': 'description',
  'tours.image_url': 'imageUrl',
  'tours.schedule': 'schedule',
} as const;
export type TourFieldPath = keyof typeof TOUR_FIELDS;

/** When and in which state a concert is: a partial date, a local time with a complete one, and its IANA zone. */
export interface EventScheduleValue {
  status: EventStatus;
  startDate: PartialDateValue | null;
  startTime: string | null;
  timezone: string | null;
}

/** Where a concert is. */
export interface EventLocationValue {
  countryId: number | null;
  city: string | null;
  venueName: string | null;
}

/** An event as its creation proposes it and its revisions record it. */
export interface EventValue extends Partial<Omit<EventScheduleValue, 'status'>>, Partial<EventLocationValue> {
  title: string;
  status: EventStatus;
  tour?: RootReference | null;
  description?: string | null;
  imageUrl?: string | null;
}

export const EVENT_FIELDS = {
  'events.title': 'title',
  'events.description': 'description',
  'events.image_url': 'imageUrl',
  'events.tour': 'tour',
  'events.schedule': 'schedule',
  'events.location': 'location',
} as const;
export type EventFieldPath = keyof typeof EVENT_FIELDS;

/** An artist announced for a tour or concert, keyed by the root and the artist. */
export interface LiveArtistValue {
  role: LiveArtistRole;
  position: number;
  creditedAs?: string | null;
}

/** An organizer of a tour or concert, keyed by the root and the identity. */
export interface OrganizerValue {
  position: number;
  details?: string | null;
}

/** An external page of a tour or concert, keyed by its generated id. Only a tour's has a country. */
export interface LinkValue {
  label: string;
  url: string;
  purpose: LinkPurpose;
  position: number;
  countryId?: number | null;
}

export type LiveRoot = 'tour' | 'event';

const partialDate = (year: number | null, month: number | null, day: number | null): PartialDateValue | null =>
  year === null ? null : { year, ...(month !== null ? { month } : {}), ...(day !== null ? { day } : {}) };

function dateColumns(prefix: 'start' | 'end', date: PartialDateValue | null | undefined) {
  return { [`${prefix}Year`]: date?.year ?? null, [`${prefix}Month`]: date?.month ?? null, [`${prefix}Day`]: date?.day ?? null };
}

// Tours

/** The internal id of the tour of an editorial root, or null while it is only reserved. */
export async function tourIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const tour = await manager.findOne(Tour, { select: { id: true }, where: { editorialEntityId: editorialEntityId.toLowerCase() } });
  return tour?.id ?? null;
}

export async function findCreatedTour(manager: EntityManager, editorialEntityId: string): Promise<{ tour: Tour; value: Required<TourValue> } | null> {
  const tour = await manager.findOneBy(Tour, { editorialEntityId });
  if (!tour) return null;
  return {
    tour,
    value: {
      title: tour.title,
      status: tour.status,
      startDate: partialDate(tour.startYear, tour.startMonth, tour.startDay),
      endDate: partialDate(tour.endYear, tour.endMonth, tour.endDay),
      description: tour.description,
      imageUrl: tour.imageUrl,
    },
  };
}

export function tourFieldValue(value: Required<TourValue>, path: TourFieldPath): unknown {
  if (path === 'tours.schedule') return { status: value.status, startDate: value.startDate, endDate: value.endDate };
  return value[TOUR_FIELDS[path] as Exclude<(typeof TOUR_FIELDS)[TourFieldPath], 'schedule'>];
}

export async function createTour(manager: EntityManager, editorialEntityId: string, value: TourValue, now: Date): Promise<Tour> {
  await manager.insert(Tour, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    title: value.title,
    status: value.status,
    ...dateColumns('start', value.startDate),
    ...dateColumns('end', value.endDate),
    description: value.description ?? null,
    imageUrl: value.imageUrl ?? null,
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedTour(manager, editorialEntityId))!.tour;
}

export async function writeTourField(manager: EntityManager, editorialEntityId: string, path: TourFieldPath, value: unknown, now: Date): Promise<unknown> {
  let columns: object;
  if (path === 'tours.schedule') {
    const schedule = value as TourScheduleValue;
    columns = { status: schedule.status, ...dateColumns('start', schedule.startDate), ...dateColumns('end', schedule.endDate) };
  } else {
    columns = { [TOUR_FIELDS[path]]: value };
  }
  await manager.update(Tour, { editorialEntityId }, { ...columns, updatedAt: now });
  return tourFieldValue((await findCreatedTour(manager, editorialEntityId))!.value, path);
}

// Events

/** The internal id of the event of an editorial root, or null while it is only reserved. */
export async function eventIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const event = await manager.findOne(LiveEvent, { select: { id: true }, where: { editorialEntityId: editorialEntityId.toLowerCase() } });
  return event?.id ?? null;
}

export async function findCreatedEvent(manager: EntityManager, editorialEntityId: string): Promise<{ event: LiveEvent; value: Required<EventValue> } | null> {
  const event = await manager.findOneBy(LiveEvent, { editorialEntityId });
  if (!event) return null;
  const tour = event.tourId === null ? null : await manager.findOneByOrFail(Tour, { id: event.tourId });
  return {
    event,
    value: {
      title: event.title,
      status: event.status,
      tour: tour && { entity_id: tour.editorialEntityId },
      startDate: partialDate(event.startYear, event.startMonth, event.startDay),
      // Stored with seconds; proposed and shown as HH:MM.
      startTime: event.startTime?.slice(0, 5) ?? null,
      timezone: event.timezone,
      countryId: event.countryId,
      city: event.city,
      venueName: event.venueName,
      description: event.description,
      imageUrl: event.imageUrl,
    },
  };
}

export function eventFieldValue(value: Required<EventValue>, path: EventFieldPath): unknown {
  if (path === 'events.schedule') return { status: value.status, startDate: value.startDate, startTime: value.startTime, timezone: value.timezone };
  if (path === 'events.location') return { countryId: value.countryId, city: value.city, venueName: value.venueName };
  return value[EVENT_FIELDS[path] as 'title' | 'description' | 'imageUrl' | 'tour'];
}

function scheduleColumns({ status, startDate, startTime, timezone }: Partial<EventScheduleValue>) {
  return { ...(status ? { status } : {}), ...dateColumns('start', startDate), startTime: startTime ?? null, timezone: timezone ?? null };
}

async function tourColumn(manager: EntityManager, tour: RootReference | null | undefined): Promise<number | null> {
  return tour ? (await tourIdOf(manager, tour.entity_id))! : null;
}

export async function createEvent(manager: EntityManager, editorialEntityId: string, value: EventValue, now: Date): Promise<LiveEvent> {
  await manager.insert(LiveEvent, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    title: value.title,
    type: 'concert',
    tourId: await tourColumn(manager, value.tour),
    ...scheduleColumns(value),
    status: value.status,
    countryId: value.countryId ?? null,
    city: value.city ?? null,
    venueName: value.venueName ?? null,
    description: value.description ?? null,
    imageUrl: value.imageUrl ?? null,
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedEvent(manager, editorialEntityId))!.event;
}

export async function writeEventField(manager: EntityManager, editorialEntityId: string, path: EventFieldPath, value: unknown, now: Date): Promise<unknown> {
  let columns: object;
  if (path === 'events.schedule') columns = scheduleColumns(value as EventScheduleValue);
  else if (path === 'events.location') columns = { ...(value as EventLocationValue) };
  else if (path === 'events.tour') columns = { tourId: await tourColumn(manager, value as RootReference | null) };
  else columns = { [EVENT_FIELDS[path]]: value };
  await manager.update(LiveEvent, { editorialEntityId }, { ...columns, updatedAt: now });
  return eventFieldValue((await findCreatedEvent(manager, editorialEntityId))!.value, path);
}

// Artists, organizers and links

const ARTISTS = { tour: TourArtist, event: EventArtist } as const;
const ORGANIZERS = { tour: TourOrganizer, event: EventOrganizer } as const;
const LINKS = { tour: TourLink, event: EventLink } as const;
const ROOTS = { tour: Tour, event: LiveEvent } as const;
const ownerColumn = (root: LiveRoot) => (root === 'tour' ? 'tourId' : 'eventId');

async function touch(manager: EntityManager, root: LiveRoot, id: number, now: Date): Promise<void> {
  await manager.update(ROOTS[root], { id }, { updatedAt: now });
}

export async function findLiveArtist(manager: EntityManager, root: LiveRoot, ownerId: number, artistId: number): Promise<LiveArtistValue | null> {
  const row = await manager.findOneBy(ARTISTS[root] as typeof TourArtist, { [ownerColumn(root)]: ownerId, artistId } as never);
  return row && { role: row.role, position: row.position, creditedAs: row.creditedAs };
}

export async function writeLiveArtist(manager: EntityManager, root: LiveRoot, ownerId: number, artistId: number, value: LiveArtistValue, now: Date): Promise<void> {
  const where = { [ownerColumn(root)]: ownerId, artistId } as never;
  const columns = { role: value.role, position: value.position, creditedAs: value.creditedAs ?? null };
  const entity = ARTISTS[root] as typeof TourArtist;
  if (await manager.existsBy(entity, where)) await manager.update(entity, where, { ...columns, updatedAt: now });
  else await manager.insert(entity, { ...(where as object), ...columns, createdAt: now, updatedAt: now });
  await touch(manager, root, ownerId, now);
}

export async function deleteLiveArtist(manager: EntityManager, root: LiveRoot, ownerId: number, artistId: number, now: Date): Promise<void> {
  await manager.delete(ARTISTS[root] as typeof TourArtist, { [ownerColumn(root)]: ownerId, artistId } as never);
  await touch(manager, root, ownerId, now);
}

export async function findOrganizer(manager: EntityManager, root: LiveRoot, ownerId: number, catalogIdentityId: number): Promise<OrganizerValue | null> {
  const row = await manager.findOneBy(ORGANIZERS[root] as typeof TourOrganizer, { [ownerColumn(root)]: ownerId, catalogIdentityId } as never);
  return row && { position: row.position, details: row.details };
}

export async function writeOrganizer(manager: EntityManager, root: LiveRoot, ownerId: number, catalogIdentityId: number, value: OrganizerValue, now: Date): Promise<void> {
  const where = { [ownerColumn(root)]: ownerId, catalogIdentityId } as never;
  const columns = { position: value.position, details: value.details ?? null };
  const entity = ORGANIZERS[root] as typeof TourOrganizer;
  if (await manager.existsBy(entity, where)) await manager.update(entity, where, { ...columns, updatedAt: now });
  else await manager.insert(entity, { ...(where as object), ...columns, createdAt: now, updatedAt: now });
  await touch(manager, root, ownerId, now);
}

export async function deleteOrganizer(manager: EntityManager, root: LiveRoot, ownerId: number, catalogIdentityId: number, now: Date): Promise<void> {
  await manager.delete(ORGANIZERS[root] as typeof TourOrganizer, { [ownerColumn(root)]: ownerId, catalogIdentityId } as never);
  await touch(manager, root, ownerId, now);
}

function linkValue(root: LiveRoot, row: TourLink | EventLink): LinkValue {
  const value: LinkValue = { label: row.label, url: row.url, purpose: row.purpose, position: row.position };
  return root === 'tour' ? { ...value, countryId: (row as TourLink).countryId } : value;
}

export async function findLink(manager: EntityManager, root: LiveRoot, ownerId: number, id: number): Promise<LinkValue | null> {
  const row = await manager.findOneBy(LINKS[root] as typeof TourLink, { [ownerColumn(root)]: ownerId, id } as never);
  return row && linkValue(root, row);
}

/** The link of a root with the unique key of a value: its URL and, in a tour, its country. */
async function linkByUniqueKey(manager: EntityManager, root: LiveRoot, ownerId: number, value: LinkValue): Promise<TourLink | EventLink | null> {
  const builder = manager
    .createQueryBuilder(LINKS[root] as typeof TourLink, 'link')
    .where(`link.${root}_id = :ownerId AND link.url = :url`, { ownerId, url: value.url });
  if (root === 'tour') builder.andWhere('link.country_id IS NOT DISTINCT FROM :countryId', { countryId: value.countryId ?? null });
  return builder.getOne();
}

export async function findLinkByUniqueKey(manager: EntityManager, root: LiveRoot, ownerId: number, value: LinkValue): Promise<LinkValue | null> {
  const row = await linkByUniqueKey(manager, root, ownerId, value);
  return row && linkValue(root, row);
}

/** What a link would break besides itself: another link of the root with its URL (and country, in a tour). */
export async function linkClashes(manager: EntityManager, root: LiveRoot, ownerId: number, value: LinkValue, replacedId: number | null): Promise<string[]> {
  const row = await linkByUniqueKey(manager, root, ownerId, value);
  if (!row || row.id === replacedId) return [];
  return [root === 'tour' ? 'El tour ya tiene ese enlace para ese país' : 'El concierto ya tiene ese enlace'];
}

function linkColumns(root: LiveRoot, value: LinkValue) {
  const columns = { label: value.label, url: value.url, purpose: value.purpose, position: value.position };
  return root === 'tour' ? { ...columns, countryId: value.countryId ?? null } : columns;
}

export async function insertLink(manager: EntityManager, root: LiveRoot, ownerId: number, value: LinkValue, now: Date): Promise<number> {
  const result = await manager.insert(LINKS[root] as typeof TourLink, {
    [ownerColumn(root)]: ownerId,
    ...linkColumns(root, value),
    createdAt: now,
    updatedAt: now,
  } as never);
  await touch(manager, root, ownerId, now);
  return result.identifiers[0].id;
}

export async function updateLink(manager: EntityManager, root: LiveRoot, ownerId: number, id: number, value: LinkValue, now: Date): Promise<void> {
  await manager.update(LINKS[root] as typeof TourLink, { [ownerColumn(root)]: ownerId, id } as never, { ...linkColumns(root, value), updatedAt: now } as never);
  await touch(manager, root, ownerId, now);
}

export async function deleteLink(manager: EntityManager, root: LiveRoot, ownerId: number, id: number, now: Date): Promise<void> {
  await manager.delete(LINKS[root] as typeof TourLink, { [ownerColumn(root)]: ownerId, id } as never);
  await touch(manager, root, ownerId, now);
}
