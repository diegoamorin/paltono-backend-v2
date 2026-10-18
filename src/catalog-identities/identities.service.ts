import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { Country } from '../vocabularies/entities/country.entity';
import { CATALOG_IDENTITY_TYPES, CatalogIdentity, Organization, Person } from './entities/catalog-identity.entity';
import {
  CatalogIdentityAlias,
  CatalogIdentityPlatformLink,
  OrganizationTypeAssignment,
  PersonNationality,
} from './entities/identity-relation.entity';
import { IdentityEntry, IdentityRelations } from './identity.resource';

/** The column behind each sort field of the list. */
const SORT_COLUMNS: Record<string, string> = { displayName: 'identity.display_name', createdAt: 'identity.created_at', id: 'identity.public_id' };

/**
 * Public reads of identities. A row only exists once its creation is applied,
 * so a reservation is never found; a withdrawn one keeps its row and answers
 * with its notice.
 */
@Injectable()
export class IdentitiesService {
  constructor(private readonly dataSource: DataSource) {}

  async show(publicId: string): Promise<IdentityEntry> {
    const manager = this.dataSource.manager;
    const identity = await manager.findOne(CatalogIdentity, { where: { publicId }, relations: { editorialEntity: true } });
    if (!identity) {
      throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    }
    return (await loadEntries(manager, [identity]))[0];
  }

  /**
   * Published identities only: a withdrawn entry is reached by its id, but a
   * list would sort and filter it by the content it no longer shows.
   */
  async list(query: CollectionQuery): Promise<{ entries: IdentityEntry[]; total: number }> {
    const { q, type, hasArtistProfile, nationality, originCountry, organizationType } = query.filter;
    const builder = this.dataSource.manager
      .createQueryBuilder(CatalogIdentity, 'identity')
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
    if (type !== undefined) {
      requireOneOf('filter[type]', type, CATALOG_IDENTITY_TYPES);
      builder.andWhere('identity.type = :type', { type });
    }
    if (hasArtistProfile !== undefined) {
      requireOneOf('filter[hasArtistProfile]', hasArtistProfile, ['true', 'false']);
      // Artist profiles arrive with the artists of the catalog; until then no identity has one.
      if (hasArtistProfile === 'true') builder.andWhere('false');
    }
    if (nationality !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM person_nationalities nationality JOIN countries nationality_country ON nationality_country.id = nationality.country_id
          WHERE nationality.person_id = identity.id AND nationality_country.code = :nationality
        )`,
        { nationality: nationality.toUpperCase() },
      );
    }
    if (originCountry !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM organizations origin JOIN countries origin_country ON origin_country.id = origin.origin_country_id
          WHERE origin.catalog_identity_id = identity.id AND origin_country.code = :originCountry
        )`,
        { originCountry: originCountry.toUpperCase() },
      );
    }
    if (organizationType !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM organization_type_assignments assignment
          JOIN organization_types assigned_type ON assigned_type.id = assignment.organization_type_id
          WHERE assignment.organization_id = identity.id AND assigned_type.slug = :organizationType
        )`,
        { organizationType },
      );
    }
    for (const { field, direction } of query.sort) builder.addOrderBy(SORT_COLUMNS[field], direction);
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await loadEntries(this.dataSource.manager, page), total };
  }
}

/** The given identities, with their editorial roots loaded, as entries with their subtypes and relations. */
async function loadEntries(manager: EntityManager, identities: CatalogIdentity[]): Promise<IdentityEntry[]> {
  // A withdrawn entry only shows its notice: its subtype and relations are not even read.
  const ids = identities.filter(({ editorialEntity }) => editorialEntity!.publicationStatus !== 'withdrawn').map(({ id }) => id);
  if (ids.length === 0) return identities.map((identity) => ({ identity, person: null, organization: null, relations: null }));
  const [people, organizations, aliases, nationalities, assignments, platformLinks] = await Promise.all([
    manager.findBy(Person, { catalogIdentityId: In(ids) }),
    manager.find(Organization, { where: { catalogIdentityId: In(ids) }, relations: { originCountry: true } }),
    manager.find(CatalogIdentityAlias, { where: { catalogIdentityId: In(ids) }, order: { sortOrder: 'ASC', id: 'ASC' } }),
    manager.find(PersonNationality, { where: { personId: In(ids) }, relations: { country: true }, order: { countryId: 'ASC' } }),
    manager.find(OrganizationTypeAssignment, {
      where: { organizationId: In(ids) },
      relations: { organizationType: true },
      order: { organizationTypeId: 'ASC' },
    }),
    manager.find(CatalogIdentityPlatformLink, { where: { catalogIdentityId: In(ids) }, relations: { platform: true }, order: { id: 'ASC' } }),
  ]);
  return identities.map((identity) => {
    if (!ids.includes(identity.id)) return { identity, person: null, organization: null, relations: null };
    /** The rows of this identity, whose id the given column holds. */
    const own = <T>(rows: T[], ownerId: (row: T) => number) => rows.filter((row) => ownerId(row) === identity.id);
    const organization = own(organizations, (row) => row.catalogIdentityId)[0] ?? null;
    const relations: IdentityRelations = {
      aliases: own(aliases, (row) => row.catalogIdentityId),
      nationalities: own(nationalities, (row) => row.personId).map(({ country }) => country as Country),
      originCountry: organization?.originCountry ?? null,
      organizationTypes: own(assignments, (row) => row.organizationId).map(({ organizationType }) => organizationType!),
      platformLinks: own(platformLinks, (row) => row.catalogIdentityId),
    };
    return { identity, person: own(people, (row) => row.catalogIdentityId)[0] ?? null, organization, relations };
  });
}
