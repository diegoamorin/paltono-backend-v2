import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { CatalogIdentity } from '../catalog-identities/entities/catalog-identity.entity';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { TOUR_STATUSES, Tour } from './entities/live-event.entity';
import { tourEntries } from './live-event-entries';
import { TourEntry } from './live-event.resource';

/** The expression behind each sort field of the list; tours without an announced start go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  startDate: `CASE WHEN tour.start_year IS NOT NULL THEN make_date(tour.start_year, coalesce(tour.start_month, 1), coalesce(tour.start_day, 1)) END`,
  title: 'tour.title',
  id: 'tour.public_id',
};

type Scope = { organizerId: number } | { artistId: number };

/**
 * Public reads of tours. A row only exists once its creation is applied, so a
 * reservation is never found; a withdrawn one keeps its row and answers with
 * its notice, and lists only show published tours. Its countries and dates
 * come from its published events on each read.
 */
@Injectable()
export class ToursService {
  constructor(private readonly dataSource: DataSource) {}

  async show(publicId: string): Promise<TourEntry> {
    const tour = await this.dataSource.manager.findOne(Tour, { where: { publicId }, relations: { editorialEntity: true } });
    if (!tour) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'tour_not_found', detail: 'The tour does not exist' }]);
    return (await tourEntries(this.dataSource.manager, [tour]))[0];
  }

  async list(query: CollectionQuery): Promise<{ entries: TourEntry[]; total: number }> {
    return this.page(this.filtered(query), query);
  }

  /** The published tours an identity organizes; a withdrawn identity shows none. */
  async organizedBy(publicId: string, query: CollectionQuery): Promise<{ entries: TourEntry[]; total: number }> {
    const identity = await this.dataSource.manager.findOne(CatalogIdentity, { where: { publicId }, relations: { editorialEntity: true } });
    if (!identity) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    if (identity.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    return this.page(this.filtered(query, { organizerId: identity.id }), query);
  }

  /** The published tours an artist is announced in; the profile of a withdrawn identity shows none. */
  async ofArtist(publicId: string, query: CollectionQuery): Promise<{ entries: TourEntry[]; total: number }> {
    const artist = await this.dataSource.manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    if (artist.identity!.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    return this.page(this.filtered(query, { artistId: artist.id }), query);
  }

  private filtered(query: CollectionQuery, scope?: Scope): SelectQueryBuilder<Tour> {
    const builder = this.dataSource.manager
      .createQueryBuilder(Tour, 'tour')
      .innerJoinAndSelect('tour.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
    if (scope && 'organizerId' in scope) {
      builder.andWhere('EXISTS (SELECT 1 FROM tour_organizers o WHERE o.tour_id = tour.id AND o.catalog_identity_id = :scopeOrganizerId)', {
        scopeOrganizerId: scope.organizerId,
      });
    }
    if (scope && 'artistId' in scope) {
      builder.andWhere('EXISTS (SELECT 1 FROM tour_artists a WHERE a.tour_id = tour.id AND a.artist_id = :scopeArtistId)', { scopeArtistId: scope.artistId });
    }

    const { q, status, artist, organizer, country } = query.filter;
    if (q !== undefined) builder.andWhere('unaccent(lower(tour.title)) LIKE unaccent(lower(:pattern))', { pattern: containsPattern(q) });
    if (status !== undefined) {
      requireOneOf('filter[status]', status, TOUR_STATUSES);
      builder.andWhere('tour.status = :status', { status });
    }
    if (artist !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM tour_artists announced JOIN artists announced_artist ON announced_artist.id = announced.artist_id
          WHERE announced.tour_id = tour.id AND announced_artist.public_id = :artist)`,
        { artist },
      );
    }
    if (organizer !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM tour_organizers organizing JOIN catalog_identities organizing_identity ON organizing_identity.id = organizing.catalog_identity_id
          WHERE organizing.tour_id = tour.id AND organizing_identity.public_id = :organizer)`,
        { organizer },
      );
    }
    // Derived from its published events, never from a list of its own.
    if (country !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM events stop JOIN editorial_entities stop_root ON stop_root.id = stop.editorial_entity_id
          JOIN countries stop_country ON stop_country.id = stop.country_id
          WHERE stop.tour_id = tour.id AND stop_root.publication_status = 'published' AND stop_country.code = :country)`,
        { country: country.toUpperCase() },
      );
    }
    return builder;
  }

  private async page(builder: SelectQueryBuilder<Tour>, query: CollectionQuery): Promise<{ entries: TourEntry[]; total: number }> {
    query.sort.forEach(({ field, direction }, index) => {
      builder.addSelect(SORT_EXPRESSIONS[field], `sort_${index}`).addOrderBy(`sort_${index}`, direction, 'NULLS LAST');
    });
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await tourEntries(this.dataSource.manager, page), total };
  }
}
