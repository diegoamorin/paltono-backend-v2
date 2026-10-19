import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, period, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { Release } from './entities/release.entity';
import { RELEASE_AVAILABILITIES, releaseSql } from './release-dates';
import { releaseEntries } from './release-entries';
import { ReleaseGroupsService } from './release-groups.service';
import { ReleaseEntry } from './release.resource';

const NOW = 'CAST(:now AS timestamptz)';
const derived = releaseSql('release', NOW);

/** The expression behind each sort field of the list; releases without a date go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  releaseDate: derived.start,
  title: 'coalesce(release.title, grp.title)',
  createdAt: 'release.created_at',
  id: 'release.public_id',
};

/**
 * Public reads of releases. A row only exists once its creation is applied, so
 * a reservation is never found; a withdrawn one keeps its row and answers with
 * its notice. Availability is derived at the time of the request.
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly groups: ReleaseGroupsService,
  ) {}

  async show(publicId: string): Promise<ReleaseEntry> {
    const release = await this.dataSource.manager.findOne(Release, { where: { publicId }, relations: { editorialEntity: true } });
    if (!release) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'release_not_found', detail: 'The release does not exist' }]);
    return (await releaseEntries(this.dataSource.manager, [release], this.clock.now()))[0];
  }

  /** Published releases only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const builder = this.filtered(query);
    if (query.filter.releaseGroup !== undefined) builder.andWhere('grp.public_id = :releaseGroup', { releaseGroup: query.filter.releaseGroup });
    return this.page(builder, query);
  }

  /** The published releases of a release group; a withdrawn group shows none. */
  async ofReleaseGroup(publicId: string, query: CollectionQuery): Promise<{ entries: ReleaseEntry[]; total: number }> {
    const group = await this.groups.show(publicId);
    if (group.relations === null) return { entries: [], total: 0 };
    return this.page(this.filtered(query).andWhere('release.release_group_id = :groupId', { groupId: group.group.id }), query);
  }

  private filtered(query: CollectionQuery): SelectQueryBuilder<Release> {
    const builder = this.dataSource.manager
      .createQueryBuilder(Release, 'release')
      .innerJoinAndSelect('release.editorialEntity', 'root')
      .innerJoin('release.releaseGroup', 'grp')
      .where(`root.publication_status = 'published'`);
    const { q, contributor, availability, releasedFrom, releasedTo } = query.filter;
    if (q !== undefined) {
      builder.andWhere(
        `(unaccent(lower(coalesce(release.title, grp.title))) LIKE unaccent(lower(:pattern))
          OR unaccent(lower(release.edition_name)) LIKE unaccent(lower(:pattern)))`,
        { pattern: containsPattern(q) },
      );
    }
    if (contributor !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM release_contributions credit JOIN catalog_identities credited ON credited.id = credit.catalog_identity_id
          WHERE credit.release_id = release.id AND credited.public_id = :contributor
        )`,
        { contributor },
      );
    }
    if (availability !== undefined) {
      requireOneOf('filter[availability]', availability, RELEASE_AVAILABILITIES);
      builder.andWhere(`(${derived.availability}) = :availability`, { availability });
    }
    // A partial date that overlaps the range is included.
    if (releasedFrom !== undefined) builder.andWhere(`${derived.end} >= :releasedFrom`, { releasedFrom: period('filter[releasedFrom]', releasedFrom).first });
    if (releasedTo !== undefined) builder.andWhere(`${derived.start} <= :releasedTo`, { releasedTo: period('filter[releasedTo]', releasedTo).last });
    return builder;
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
