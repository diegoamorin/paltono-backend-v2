import { EntityManager, In } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { Country } from '../vocabularies/entities/country.entity';
import { EventArtist, EventLink, EventOrganizer, LiveEvent, Tour, TourArtist, TourLink, TourOrganizer } from './entities/live-event.entity';
import { EventEntry, LiveArtistEntry, OrganizerEntry, TourDerived, TourEntry } from './live-event.resource';

/*
 * Loads tours and events as entries with, for the primary data, their
 * relations. The targets of those relations are entries without relations of
 * their own, as an include reaches at most two levels. Only published events
 * count for a tour: its countries, its dates and its list of events.
 */

const notWithdrawn = (root: Tour | LiveEvent) => root.editorialEntity!.publicationStatus !== 'withdrawn';

/** SQL expressions over an `events` row aliased `e`: the first and last day its partial date may mean. */
export function eventDateSql(e: string) {
  const [year, month, day] = [`${e}.start_year`, `${e}.start_month`, `${e}.start_day`];
  return {
    start: `CASE WHEN ${year} IS NOT NULL THEN make_date(${year}, coalesce(${month}, 1), coalesce(${day}, 1)) END`,
    end: `CASE
      WHEN ${day} IS NOT NULL THEN make_date(${year}, ${month}, ${day})
      WHEN ${month} IS NOT NULL THEN (make_date(${year}, ${month}, 1) + interval '1 month - 1 day')::date
      WHEN ${year} IS NOT NULL THEN make_date(${year}, 12, 31)
    END`,
  };
}

/** The published events of the given tours, by date (undated last). */
async function publishedEventsOf(manager: EntityManager, tourIds: number[]): Promise<LiveEvent[]> {
  if (tourIds.length === 0) return [];
  return manager
    .createQueryBuilder(LiveEvent, 'event')
    .innerJoinAndSelect('event.editorialEntity', 'root')
    .leftJoinAndSelect('event.country', 'country')
    .where('event.tour_id IN (:...tourIds)', { tourIds })
    .andWhere(`root.publication_status = 'published'`)
    .orderBy('event.start_year', 'ASC', 'NULLS LAST')
    .addOrderBy('event.start_month', 'ASC', 'NULLS FIRST')
    .addOrderBy('event.start_day', 'ASC', 'NULLS FIRST')
    .addOrderBy('event.id', 'ASC')
    .getMany();
}

function derive(events: LiveEvent[]): TourDerived {
  const countries = new Map<number, Country>();
  for (const { country } of events) if (country) countries.set(country.id, country);
  return {
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    eventDates: events.flatMap(({ startYear: year, startMonth: month, startDay: day }) => (year === null ? [] : [{ year, month, day }])),
  };
}

/** Tours, each with its editorial root loaded, as entries; with their relations when `withRelations`. */
export async function tourEntries(manager: EntityManager, tours: Tour[], withRelations = true): Promise<TourEntry[]> {
  if (tours.length === 0) return [];
  const shown = tours.filter(notWithdrawn).map(({ id }) => id);
  const events = await publishedEventsOf(manager, shown);
  const plain = tours.map((tour) => ({ tour, derived: derive(events.filter(({ tourId }) => tourId === tour.id)) }));
  if (!withRelations) return plain;
  if (shown.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));

  const [artists, organizers, links, eventList] = await Promise.all([
    artistEntries(manager, await manager.find(TourArtist, { where: { tourId: In(shown) }, order: { position: 'ASC', id: 'ASC' } })),
    organizerEntries(manager, await manager.find(TourOrganizer, { where: { tourId: In(shown) }, order: { position: 'ASC', id: 'ASC' } })),
    manager.find(TourLink, { where: { tourId: In(shown) }, relations: { country: true }, order: { position: 'ASC', id: 'ASC' } }),
    eventEntries(manager, events, false),
  ]);
  return plain.map((entry) => {
    const { id } = entry.tour;
    if (!shown.includes(id)) return { ...entry, relations: null };
    return {
      ...entry,
      relations: {
        artists: artists.filter(({ row }) => (row as TourArtist).tourId === id),
        organizers: organizers.filter(({ row }) => (row as TourOrganizer).tourId === id),
        links: links.filter(({ tourId }) => tourId === id),
        events: eventList.filter(({ event }) => event.tourId === id),
      },
    };
  });
}

/** Events, each with its editorial root and country loaded, as entries; with their relations when `withRelations`. */
export async function eventEntries(manager: EntityManager, events: LiveEvent[], withRelations = true): Promise<EventEntry[]> {
  if (!withRelations) return events.map((event) => ({ event }));
  const shown = events.filter(notWithdrawn).map(({ id }) => id);
  if (shown.length === 0) return events.map((event) => ({ event, relations: null }));

  const tourIds = [...new Set(events.flatMap(({ tourId }) => (tourId === null ? [] : [tourId])))];
  const [tours, artists, organizers, links] = await Promise.all([
    tourIds.length === 0 ? [] : tourEntries(manager, await manager.find(Tour, { where: { id: In(tourIds) }, relations: { editorialEntity: true } }), false),
    artistEntries(manager, await manager.find(EventArtist, { where: { eventId: In(shown) }, order: { position: 'ASC', id: 'ASC' } })),
    organizerEntries(manager, await manager.find(EventOrganizer, { where: { eventId: In(shown) }, order: { position: 'ASC', id: 'ASC' } })),
    manager.find(EventLink, { where: { eventId: In(shown) }, order: { position: 'ASC', id: 'ASC' } }),
  ]);
  return events.map((event) => {
    if (!shown.includes(event.id)) return { event, relations: null };
    return {
      event,
      relations: {
        tour: tours.find(({ tour }) => tour.id === event.tourId) ?? null,
        artists: artists.filter(({ row }) => (row as EventArtist).eventId === event.id),
        organizers: organizers.filter(({ row }) => (row as EventOrganizer).eventId === event.id),
        links: links.filter(({ eventId }) => eventId === event.id),
        country: event.country ?? null,
      },
    };
  });
}

/** Announced artists with their profiles and identities, in the given order. */
async function artistEntries(manager: EntityManager, rows: (TourArtist | EventArtist)[]): Promise<LiveArtistEntry[]> {
  if (rows.length === 0) return [];
  const artists = await manager.find(Artist, { where: { id: In([...new Set(rows.map(({ artistId }) => artistId))]) } });
  const identities = await identityEntriesById(manager, artists.map(({ catalogIdentityId }) => catalogIdentityId));
  return rows.map((row) => {
    const artist = artists.find(({ id }) => id === row.artistId)!;
    return { row, artist: { artist, identity: identities.get(artist.catalogIdentityId)! } };
  });
}

/** Organizers with their identities, in the given order. */
async function organizerEntries(manager: EntityManager, rows: (TourOrganizer | EventOrganizer)[]): Promise<OrganizerEntry[]> {
  if (rows.length === 0) return [];
  const identities = await identityEntriesById(manager, rows.map(({ catalogIdentityId }) => catalogIdentityId));
  return rows.map((row) => ({ row, identity: identities.get(row.catalogIdentityId)! }));
}
