import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { Country } from '../vocabularies/entities/country.entity';
import { Artist, OrganizationMembership, OrganizationMembershipRole } from './entities/artist.entity';
import { MembershipEntry } from './membership.resource';
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
   * The memberships of an identity as organization, as member or both. Those
   * of a withdrawn organization are part of its withdrawn content and never
   * listed; a withdrawn member shows its notice.
   */
  async memberships(publicId: string, query: CollectionQuery): Promise<{ entries: MembershipEntry[]; total: number }> {
    const manager = this.dataSource.manager;
    const identity = await manager.findOneBy(CatalogIdentity, { publicId });
    if (!identity) {
      throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    }
    const { side } = query.filter;
    if (side !== undefined) requireOneOf('filter[side]', side, ['organization', 'member']);
    const builder = manager
      .createQueryBuilder(OrganizationMembership, 'membership')
      .innerJoin(CatalogIdentity, 'organization', 'organization.id = membership.organization_id')
      .innerJoin('organization.editorialEntity', 'organization_root')
      .where(`organization_root.publication_status = 'published'`);
    const sides = {
      organization: 'membership.organization_id = :id',
      member: 'membership.member_identity_id = :id',
    };
    builder.andWhere(side === undefined ? `(${sides.organization} OR ${sides.member})` : sides[side as keyof typeof sides], { id: identity.id });
    for (const { field, direction } of query.sort) {
      if (field === 'joined') {
        // Unknown dates last, and a less precise date before the more precise ones within it.
        builder.addOrderBy('membership.joined_year', direction, direction === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST');
        builder.addOrderBy('membership.joined_month', direction, direction === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST');
        builder.addOrderBy('membership.joined_day', direction, direction === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST');
      } else {
        builder.addOrderBy(field === 'createdAt' ? 'membership.created_at' : 'membership.id', direction);
      }
    }
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await loadMemberships(manager, page), total };
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
      const has = hasArtistProfile === 'true' ? 'EXISTS' : 'NOT EXISTS';
      builder.andWhere(`${has} (SELECT 1 FROM artists artist WHERE artist.catalog_identity_id = identity.id)`);
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

/**
 * The entries of the given identities by internal id, for other modules that
 * relate to them: a withdrawn one shows only its notice there too.
 */
export async function identityEntriesById(manager: EntityManager, ids: number[]): Promise<Map<number, IdentityEntry>> {
  if (ids.length === 0) return new Map();
  const identities = await manager.find(CatalogIdentity, { where: { id: In([...new Set(ids)]) }, relations: { editorialEntity: true } });
  const entries = await loadEntries(manager, identities);
  return new Map(entries.map((entry) => [entry.identity.id, entry]));
}

/** The given memberships with both identities and their roles, each role with its vocabulary entry. */
async function loadMemberships(manager: EntityManager, memberships: OrganizationMembership[]): Promise<MembershipEntry[]> {
  if (memberships.length === 0) return [];
  const identityIds = [...new Set(memberships.flatMap(({ organizationId, memberIdentityId }) => [organizationId, memberIdentityId]))];
  const identities = await loadEntries(manager, await manager.find(CatalogIdentity, { where: { id: In(identityIds) }, relations: { editorialEntity: true } }));
  const roles = await manager.find(OrganizationMembershipRole, {
    where: { organizationMembershipId: In(memberships.map(({ id }) => id)) },
    relations: { role: { allowedScopes: true } },
    order: { position: 'ASC', contributionRoleId: 'ASC' },
  });
  const entryOf = (id: number) => identities.find(({ identity }) => identity.id === id)!;
  return memberships.map((membership) => ({
    membership,
    organization: entryOf(membership.organizationId),
    member: entryOf(membership.memberIdentityId),
    roles: roles.filter(({ organizationMembershipId }) => organizationMembershipId === membership.id),
  }));
}

/** The given identities, with their editorial roots loaded, as entries with their subtypes and relations. */
export async function loadEntries(manager: EntityManager, identities: CatalogIdentity[]): Promise<IdentityEntry[]> {
  // A withdrawn entry only shows its notice: its subtype and relations are not even read.
  const ids = identities.filter(({ editorialEntity }) => editorialEntity!.publicationStatus !== 'withdrawn').map(({ id }) => id);
  if (ids.length === 0) return identities.map((identity) => ({ identity, person: null, organization: null, relations: null }));
  const [people, organizations, aliases, nationalities, assignments, platformLinks, artists] = await Promise.all([
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
    manager.findBy(Artist, { catalogIdentityId: In(ids) }),
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
      artist: null,
    };
    const entry: IdentityEntry = { identity, person: own(people, (row) => row.catalogIdentityId)[0] ?? null, organization, relations };
    const artist = own(artists, (row) => row.catalogIdentityId)[0];
    if (artist) relations.artist = { artist, identity: entry };
    return entry;
  });
}
