import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, period, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { RELEASE_TYPES, Release } from './entities/release.entity';
import { releaseSql } from './release-dates';
import { releaseEntries } from './release-entries';
import { ReleaseEntry } from './release.resource';

const NOW = 'CAST(:now AS timestamptz)';
const derived = releaseSql('release', NOW);

/** The expression behind each sort field of the list; releases without a date go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  releaseDate: derived.start,
  title: 'release.title',
  createdAt: 'release.created_at',
  id: 'release.public_id',
};

/**
 * Public reads of releases. A row only exists once its creation is applied,
 * so a reservation is never found; a withdrawn one keeps its row and answers
 * with its notice. Dates are derived from its editions at the time of the
 * request.
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async show(publicId: string): Promise<ReleaseEntry> {
    const release = await this.dataSource.manager.findOne(Release, { where: { publicId }, relations: { editorialEntity: true } });
    if (!release) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'release_not_found', detail: 'The release does not exist' }]);
    return (await releaseEntries(this.dataSource.manager, [release], this.clock.now()))[0];
  }

  /** Published releases only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const builder = this.published();
    const { q, type, artist, upcoming, releasedFrom, releasedTo } = query.filter;
    if (q !== undefined) builder.andWhere('unaccent(lower(release.title)) LIKE unaccent(lower(:pattern))', { pattern: containsPattern(q) });
    filterByType(builder, type);
    if (artist !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM release_artist_credits credit JOIN artists credited ON credited.id = credit.artist_id
          WHERE credit.release_id = release.id AND credited.public_id = :artist
        )`,
        { artist },
      );
    }
    if (upcoming !== undefined) {
      requireOneOf('filter[upcoming]', upcoming, ['true', 'false']);
      builder.andWhere(upcoming === 'true' ? derived.upcoming : `NOT ${derived.upcoming}`);
    }
    // A partial date that overlaps the range is included.
    if (releasedFrom !== undefined) builder.andWhere(`${derived.end} >= :releasedFrom`, { releasedFrom: period('filter[releasedFrom]', releasedFrom).first });
    if (releasedTo !== undefined) builder.andWhere(`${derived.start} <= :releasedTo`, { releasedTo: period('filter[releasedTo]', releasedTo).last });
    return this.page(builder, query);
  }

  /** The published repackages that relaunch a release; a withdrawn one shows none. */
  async repackages(publicId: string, query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const original = await this.show(publicId);
    if (original.relations === null) return { entries: [], total: 0 };
    return this.page(this.published().andWhere('release.repackage_of_id = :originalId', { originalId: original.release.id }), query);
  }

  /** The discography of an artist: the published releases presented with it, one per release. */
  async ofArtist(publicId: string, query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const manager = this.dataSource.manager;
    const artist = await manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    // The profile of a withdrawn identity shows only its notice.
    if (artist.identity!.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    const builder = this.published().andWhere(
      `EXISTS (SELECT 1 FROM release_artist_credits credit WHERE credit.release_id = release.id AND credit.artist_id = :artistId)`,
      { artistId: artist.id },
    );
    filterByType(builder, query.filter.type);
    return this.page(builder, query);
  }

  private published(): SelectQueryBuilder<Release> {
    return this.dataSource.manager
      .createQueryBuilder(Release, 'release')
      .innerJoinAndSelect('release.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
  }

  private async page(builder: SelectQueryBuilder<Release>, query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const now = this.clock.now();
    builder.setParameter('now', now);
    query.sort.forEach(({ field, direction }, index) => {
      builder.addSelect(SORT_EXPRESSIONS[field], `sort_${index}`).addOrderBy(`sort_${index}`, direction, 'NULLS LAST');
    });
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await releaseEntries(this.dataSource.manager, page, now), total };
  }
}

function filterByType(builder: SelectQueryBuilder<Release>, type: string | undefined): void {
  if (type === undefined) return;
  requireOneOf('filter[type]', type, RELEASE_TYPES);
  builder.andWhere('release.type = :type', { type });
}
