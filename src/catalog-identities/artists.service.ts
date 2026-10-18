import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { ArtistEntry } from './artist.resource';
import { ASSOCIATION_STATUSES, Artist, ArtistOrganizationAffiliation } from './entities/artist.entity';
import { CATALOG_IDENTITY_TYPES, CatalogIdentity } from './entities/catalog-identity.entity';
import { loadEntries } from './identities.service';

/** The column behind each sort field of the list. */
const SORT_COLUMNS: Record<string, string> = { displayName: 'identity.display_name', createdAt: 'artist.created_at', id: 'artist.public_id' };

/**
 * Public reads of artist profiles. A profile shares the publication of its
 * identity's root: that of a withdrawn identity answers with the notice and is
 * never listed.
 */
@Injectable()
export class ArtistsService {
  constructor(private readonly dataSource: DataSource) {}

  async show(publicId: string): Promise<ArtistEntry> {
    const manager = this.dataSource.manager;
    const artist = await manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    return (await loadArtistEntries(manager, [artist]))[0];
  }

  /**
   * Artists of published identities. `affiliatedWith` and `affiliationStatus`
   * together ask for one affiliation with that organization in that status.
   */
  async list(query: CollectionQuery): Promise<{ entries: ArtistEntry[]; total: number }> {
    const { q, identityType, affiliatedWith, affiliationStatus } = query.filter;
    const builder = this.dataSource.manager
      .createQueryBuilder(Artist, 'artist')
      .innerJoinAndSelect('artist.identity', 'identity')
      .innerJoinAndSelect('identity.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
    if (q !== undefined) {
      builder.andWhere(
        `(unaccent(lower(identity.display_name)) LIKE unaccent(lower(:pattern)) OR EXISTS (
          SELECT 1 FROM catalog_identity_aliases alias
          WHERE alias.catalog_identity_id = identity.id AND unaccent(lower(alias.alias)) LIKE unaccent(lower(:pattern))
        ))`,
        { pattern: containsPattern(q) },
      );
    }
    if (identityType !== undefined) {
      requireOneOf('filter[identityType]', identityType, CATALOG_IDENTITY_TYPES);
      builder.andWhere('identity.type = :identityType', { identityType });
    }
    if (affiliationStatus !== undefined) requireOneOf('filter[affiliationStatus]', affiliationStatus, ASSOCIATION_STATUSES);
    if (affiliatedWith !== undefined || affiliationStatus !== undefined) {
      const conditions = ['affiliation.artist_id = artist.id'];
      if (affiliatedWith !== undefined) conditions.push('affiliated.public_id = :affiliatedWith');
      if (affiliationStatus !== undefined) conditions.push('affiliation.status = :affiliationStatus');
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM artist_organization_affiliations affiliation
          JOIN catalog_identities affiliated ON affiliated.id = affiliation.organization_id
          WHERE ${conditions.join(' AND ')}
        )`,
        { affiliatedWith, affiliationStatus },
      );
    }
    for (const { field, direction } of query.sort) builder.addOrderBy(SORT_COLUMNS[field], direction);
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await loadArtistEntries(this.dataSource.manager, page), total };
  }
}

/** The given artists, with their identities and editorial roots loaded, as entries with their affiliations. */
export async function loadArtistEntries(manager: EntityManager, artists: Artist[]): Promise<ArtistEntry[]> {
  const identities = await loadEntries(manager, artists.map(({ identity }) => identity!));
  // A withdrawn identity shows only its notice, so its profile's affiliations are not even read.
  const shown = artists.filter(({ identity }) => identity!.editorialEntity!.publicationStatus !== 'withdrawn').map(({ id }) => id);
  const affiliations =
    shown.length === 0
      ? []
      : await manager.find(ArtistOrganizationAffiliation, { where: { artistId: In(shown) }, order: { startedAt: 'ASC', id: 'ASC' } });
  const organizationIds = [...new Set(affiliations.map(({ organizationId }) => organizationId))];
  const organizations =
    organizationIds.length === 0
      ? []
      : await loadEntries(manager, await manager.find(CatalogIdentity, { where: { id: In(organizationIds) }, relations: { editorialEntity: true } }));
  return artists.map((artist, index) => ({
    artist,
    identity: identities[index],
    affiliations: shown.includes(artist.id)
      ? affiliations
          .filter(({ artistId }) => artistId === artist.id)
          .map((affiliation) => ({ affiliation, organization: organizations.find(({ identity }) => identity.id === affiliation.organizationId)! }))
      : undefined,
  }));
}
