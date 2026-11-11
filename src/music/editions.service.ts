import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, period, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { Edition } from './entities/edition.entity';
import { EDITION_AVAILABILITIES, editionSql } from './release-dates';
import { editionEntries } from './release-entries';
import { ReleasesService } from './releases.service';
import { EditionEntry } from './release.resource';

const NOW = 'CAST(:now AS timestamptz)';
const derived = editionSql('edition', NOW);

/** The expression behind each sort field of the list; editions without a date go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  releaseDate: derived.start,
  title: 'coalesce(edition.title, release.title)',
  createdAt: 'edition.created_at',
  id: 'edition.public_id',
};

/**
 * Public reads of editions. A row only exists once its creation is applied, so
 * a reservation is never found; a withdrawn one keeps its row and answers with
 * its notice. Availability is derived at the time of the request.
 */
@Injectable()
export class EditionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly releases: ReleasesService,
  ) {}

  async show(publicId: string): Promise<EditionEntry> {
    const edition = await this.dataSource.manager.findOne(Edition, { where: { publicId }, relations: { editorialEntity: true } });
    if (!edition) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'edition_not_found', detail: 'The edition does not exist' }]);
    return (await editionEntries(this.dataSource.manager, [edition], this.clock.now()))[0];
  }

  /** Published editions only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: EditionEntry[]; total: number }> {
    const builder = this.filtered(query);
    if (query.filter.release !== undefined) builder.andWhere('release.public_id = :release', { release: query.filter.release });
    return this.page(builder, query);
  }

  /** The published editions of a release; a withdrawn release shows none. */
  async ofRelease(publicId: string, query: CollectionQuery): Promise<{ entries: EditionEntry[]; total: number }> {
    const release = await this.releases.show(publicId);
    if (release.relations === null) return { entries: [], total: 0 };
    return this.page(this.filtered(query).andWhere('edition.release_id = :releaseId', { releaseId: release.release.id }), query);
  }

  private filtered(query: CollectionQuery): SelectQueryBuilder<Edition> {
    const builder = this.dataSource.manager
      .createQueryBuilder(Edition, 'edition')
      .innerJoinAndSelect('edition.editorialEntity', 'root')
      .innerJoin('edition.release', 'release')
      .where(`root.publication_status = 'published'`);
    const { q, contributor, availability, releasedFrom, releasedTo } = query.filter;
    if (q !== undefined) {
      builder.andWhere(
        `(unaccent(lower(coalesce(edition.title, release.title))) LIKE unaccent(lower(:pattern))
          OR unaccent(lower(edition.edition_name)) LIKE unaccent(lower(:pattern)))`,
        { pattern: containsPattern(q) },
      );
    }
    if (contributor !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM edition_contributions credit JOIN catalog_identities credited ON credited.id = credit.catalog_identity_id
          WHERE credit.edition_id = edition.id AND credited.public_id = :contributor
        )`,
        { contributor },
      );
    }
    if (availability !== undefined) {
      requireOneOf('filter[availability]', availability, EDITION_AVAILABILITIES);
      builder.andWhere(`(${derived.availability}) = :availability`, { availability });
    }
    // A partial date that overlaps the range is included.
    if (releasedFrom !== undefined) builder.andWhere(`${derived.end} >= :releasedFrom`, { releasedFrom: period('filter[releasedFrom]', releasedFrom).first });
    if (releasedTo !== undefined) builder.andWhere(`${derived.start} <= :releasedTo`, { releasedTo: period('filter[releasedTo]', releasedTo).last });
    return builder;
  }

  private async page(builder: SelectQueryBuilder<Edition>, query: CollectionQuery): Promise<{ entries: EditionEntry[]; total: number }> {
    const now = this.clock.now();
    builder.setParameter('now', now);
    query.sort.forEach(({ field, direction }, index) => {
      builder.addSelect(SORT_EXPRESSIONS[field], `sort_${index}`).addOrderBy(`sort_${index}`, direction, 'NULLS LAST');
    });
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await editionEntries(this.dataSource.manager, page, now), total };
  }
}
