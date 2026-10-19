import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, period, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { RELEASE_GROUP_TYPES, ReleaseGroup } from './entities/release.entity';
import { releaseGroupSql } from './release-dates';
import { releaseGroupEntries } from './release-entries';
import { ReleaseGroupEntry } from './release.resource';

const NOW = 'CAST(:now AS timestamptz)';
const derived = releaseGroupSql('grp', NOW);

/** The expression behind each sort field of the list; groups without a date go last either way. */
const SORT_EXPRESSIONS: Record<string, string> = {
  releaseDate: derived.start,
  title: 'grp.title',
  createdAt: 'grp.created_at',
  id: 'grp.public_id',
};

/**
 * Public reads of release groups. A row only exists once its creation is
 * applied, so a reservation is never found; a withdrawn one keeps its row and
 * answers with its notice. Dates are derived from its releases at the time of
 * the request.
 */
@Injectable()
export class ReleaseGroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async show(publicId: string): Promise<ReleaseGroupEntry> {
    const group = await this.dataSource.manager.findOne(ReleaseGroup, { where: { publicId }, relations: { editorialEntity: true } });
    if (!group) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'release_group_not_found', detail: 'The release group does not exist' }]);
    return (await releaseGroupEntries(this.dataSource.manager, [group], this.clock.now()))[0];
  }

  /** Published release groups only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: ReleaseGroupEntry[]; total: number }> {
    const builder = this.published();
    const { q, type, artist, upcoming, releasedFrom, releasedTo } = query.filter;
    if (q !== undefined) builder.andWhere('unaccent(lower(grp.title)) LIKE unaccent(lower(:pattern))', { pattern: containsPattern(q) });
    filterByType(builder, type);
    if (artist !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM release_artist_credits credit JOIN artists credited ON credited.id = credit.artist_id
          WHERE credit.release_group_id = grp.id AND credited.public_id = :artist
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

  /** The published repackages that relaunch a release group; a withdrawn one shows none. */
  async repackages(publicId: string, query: CollectionQuery): Promise<{ entries: ReleaseGroupEntry[]; total: number }> {
    const original = await this.show(publicId);
    if (original.relations === null) return { entries: [], total: 0 };
    return this.page(this.published().andWhere('grp.repackage_of_id = :originalId', { originalId: original.group.id }), query);
  }

  /** The discography of an artist: the published release groups presented with it, one per group. */
  async ofArtist(publicId: string, query: CollectionQuery): Promise<{ entries: ReleaseGroupEntry[]; total: number }> {
    const manager = this.dataSource.manager;
    const artist = await manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    // The profile of a withdrawn identity shows only its notice.
    if (artist.identity!.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    const builder = this.published().andWhere(
      `EXISTS (SELECT 1 FROM release_artist_credits credit WHERE credit.release_group_id = grp.id AND credit.artist_id = :artistId)`,
      { artistId: artist.id },
    );
    filterByType(builder, query.filter.type);
    return this.page(builder, query);
  }

  private published(): SelectQueryBuilder<ReleaseGroup> {
    return this.dataSource.manager
      .createQueryBuilder(ReleaseGroup, 'grp')
      .innerJoinAndSelect('grp.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
  }

  private async page(builder: SelectQueryBuilder<ReleaseGroup>, query: CollectionQuery): Promise<{ entries: ReleaseGroupEntry[]; total: number }> {
    const now = this.clock.now();
    builder.setParameter('now', now);
    query.sort.forEach(({ field, direction }, index) => {
      builder.addSelect(SORT_EXPRESSIONS[field], `sort_${index}`).addOrderBy(`sort_${index}`, direction, 'NULLS LAST');
    });
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await releaseGroupEntries(this.dataSource.manager, page, now), total };
  }
}

function filterByType(builder: SelectQueryBuilder<ReleaseGroup>, type: string | undefined): void {
  if (type === undefined) return;
  requireOneOf('filter[type]', type, RELEASE_GROUP_TYPES);
  builder.andWhere('grp.type = :type', { type });
}
