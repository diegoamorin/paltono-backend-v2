import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { CatalogIdentity } from '../catalog-identities/entities/catalog-identity.entity';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, period, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { EVENT_STATUSES, LiveEvent, Tour } from './entities/live-event.entity';
import { eventDateSql, eventEntries } from './live-event-entries';
import { EventEntry } from './live-event.resource';

const dates = eventDateSql('event');

/** The expression behind each sort field of the list; events without a date go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  startDate: dates.start,
  createdAt: 'event.created_at',
  id: 'event.public_id',
};

/** What a list of events is restricted to besides its filters. */
type Scope = { tourId: number } | { organizerId: number } | { artistId: number };

/**
 * Public reads of events. A row only exists once its creation is applied, so
 * a reservation is never found; a withdrawn one keeps its row and answers with
 * its notice, and lists only show published events.
 */
@Injectable()
export class EventsService {
  constructor(private readonly dataSource: DataSource) {}

  async show(publicId: string): Promise<EventEntry> {
    const event = await this.dataSource.manager.findOne(LiveEvent, { where: { publicId }, relations: { editorialEntity: true, country: true } });
    if (!event) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'event_not_found', detail: 'The event does not exist' }]);
    return (await eventEntries(this.dataSource.manager, [event]))[0];
  }

  async list(query: CollectionQuery): Promise<{ entries: EventEntry[]; total: number }> {
    return this.page(this.filtered(query), query);
  }

  /** The published events of a tour; a withdrawn tour shows none. */
  async ofTour(publicId: string, query: CollectionQuery): Promise<{ entries: EventEntry[]; total: number }> {
    const tour = await this.dataSource.manager.findOne(Tour, { where: { publicId }, relations: { editorialEntity: true } });
    if (!tour) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'tour_not_found', detail: 'The tour does not exist' }]);
    if (tour.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    return this.page(this.filtered(query, { tourId: tour.id }), query);
  }

  /** The published events an identity organizes; a withdrawn identity shows none. */
  async organizedBy(publicId: string, query: CollectionQuery): Promise<{ entries: EventEntry[]; total: number }> {
    const identity = await this.dataSource.manager.findOne(CatalogIdentity, { where: { publicId }, relations: { editorialEntity: true } });
    if (!identity) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    if (identity.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    return this.page(this.filtered(query, { organizerId: identity.id }), query);
  }

  /** The published events an artist is announced in; the profile of a withdrawn identity shows none. */
  async ofArtist(publicId: string, query: CollectionQuery): Promise<{ entries: EventEntry[]; total: number }> {
    const artist = await this.dataSource.manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    if (artist.identity!.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    return this.page(this.filtered(query, { artistId: artist.id }), query);
  }

  private filtered(query: CollectionQuery, scope?: Scope): SelectQueryBuilder<LiveEvent> {
    const builder = this.dataSource.manager
      .createQueryBuilder(LiveEvent, 'event')
      .innerJoinAndSelect('event.editorialEntity', 'root')
      .leftJoinAndSelect('event.country', 'country')
      .where(`root.publication_status = 'published'`);
    if (scope && 'tourId' in scope) builder.andWhere('event.tour_id = :scopeTourId', { scopeTourId: scope.tourId });
    if (scope && 'organizerId' in scope) {
      builder.andWhere('EXISTS (SELECT 1 FROM event_organizers o WHERE o.event_id = event.id AND o.catalog_identity_id = :scopeOrganizerId)', {
        scopeOrganizerId: scope.organizerId,
      });
    }
    if (scope && 'artistId' in scope) {
      builder.andWhere('EXISTS (SELECT 1 FROM event_artists a WHERE a.event_id = event.id AND a.artist_id = :scopeArtistId)', { scopeArtistId: scope.artistId });
    }

    const { q, status, country, city, artist, organizer, tour, dateFrom, dateTo } = query.filter;
    if (q !== undefined) {
      builder.andWhere(
        `(unaccent(lower(event.title)) LIKE unaccent(lower(:pattern)) OR unaccent(lower(event.venue_name)) LIKE unaccent(lower(:pattern))
          OR unaccent(lower(event.city)) LIKE unaccent(lower(:pattern)))`,
        { pattern: containsPattern(q) },
      );
    }
    if (status !== undefined) {
      requireOneOf('filter[status]', status, EVENT_STATUSES);
      builder.andWhere('event.status = :status', { status });
    }
    if (country !== undefined) builder.andWhere('country.code = :country', { country: country.toUpperCase() });
    if (city !== undefined) builder.andWhere('unaccent(lower(event.city)) = unaccent(lower(:city))', { city });
    if (artist !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM event_artists announced JOIN artists announced_artist ON announced_artist.id = announced.artist_id
          WHERE announced.event_id = event.id AND announced_artist.public_id = :artist)`,
        { artist },
      );
    }
    if (organizer !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM event_organizers organizing JOIN catalog_identities organizing_identity ON organizing_identity.id = organizing.catalog_identity_id
          WHERE organizing.event_id = event.id AND organizing_identity.public_id = :organizer)`,
        { organizer },
      );
    }
    if (tour !== undefined) builder.andWhere('EXISTS (SELECT 1 FROM tours of_tour WHERE of_tour.id = event.tour_id AND of_tour.public_id = :tour)', { tour });
    // A partial date that overlaps the range is included; an event without a date is not.
    if (dateFrom !== undefined) builder.andWhere(`${dates.end} >= :dateFrom`, { dateFrom: period('filter[dateFrom]', dateFrom).first });
    if (dateTo !== undefined) builder.andWhere(`${dates.start} <= :dateTo`, { dateTo: period('filter[dateTo]', dateTo).last });
    return builder;
  }

  private async page(builder: SelectQueryBuilder<LiveEvent>, query: CollectionQuery): Promise<{ entries: EventEntry[]; total: number }> {
    query.sort.forEach(({ field, direction }, index) => {
      builder.addSelect(SORT_EXPRESSIONS[field], `sort_${index}`).addOrderBy(`sort_${index}`, direction, 'NULLS LAST');
    });
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await eventEntries(this.dataSource.manager, page), total };
  }
}
