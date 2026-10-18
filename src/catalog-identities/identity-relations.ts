import { EntityManager, Not } from 'typeorm';
import { CatalogIdentity } from './entities/catalog-identity.entity';
import { CatalogIdentityAlias, CatalogIdentityPlatformLink, OrganizationTypeAssignment, PersonNationality } from './entities/identity-relation.entity';

/*
 * The reads and writes of an identity's dependent rows, which this module
 * owns. The editorial flow calls them inside the transaction that applies a
 * relation change. Every read is scoped to one identity, so a key never
 * reaches the row of another one.
 */

/** An alias as relation changes propose it and revisions record it. */
export interface AliasValue {
  alias: string;
  isPrimary: boolean;
  sortOrder: number;
}

/** A platform link as relation changes propose it and revisions record it; its play count is never written. */
export interface PlatformLinkValue {
  platformId: number;
  url: string;
}

/** The internal id of the identity of an editorial root, or null while it is only reserved. */
export async function identityIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const identity = await manager.findOne(CatalogIdentity, { select: { id: true }, where: { editorialEntityId } });
  return identity?.id ?? null;
}

export async function findAlias(manager: EntityManager, catalogIdentityId: number, id: number): Promise<AliasValue | null> {
  return aliasValue(await manager.findOneBy(CatalogIdentityAlias, { catalogIdentityId, id }));
}

/** The alias of an identity spelled as given, which its uniqueness makes unambiguous. */
export async function findAliasByName(manager: EntityManager, catalogIdentityId: number, alias: string): Promise<AliasValue | null> {
  return aliasValue(await manager.findOneBy(CatalogIdentityAlias, { catalogIdentityId, alias }));
}

/**
 * What an alias of an identity would break, besides the row it replaces: the
 * uniqueness of its spelling and of the primary alias.
 */
export async function aliasClashes(manager: EntityManager, catalogIdentityId: number, value: AliasValue, replacedId: number | null): Promise<string[]> {
  const others = replacedId === null ? {} : { id: Not(replacedId) };
  const clashes: string[] = [];
  if (await manager.existsBy(CatalogIdentityAlias, { catalogIdentityId, alias: value.alias, ...others })) {
    clashes.push(`La identidad ya tiene el alias «${value.alias}»`);
  }
  if (value.isPrimary && (await manager.existsBy(CatalogIdentityAlias, { catalogIdentityId, isPrimary: true, ...others }))) {
    clashes.push('La identidad ya tiene un alias primario');
  }
  return clashes;
}

export async function insertAlias(manager: EntityManager, catalogIdentityId: number, value: AliasValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(CatalogIdentityAlias, { catalogIdentityId, ...value });
  await touchIdentity(manager, catalogIdentityId, now);
  return identifiers[0].id as number;
}

export async function updateAlias(manager: EntityManager, catalogIdentityId: number, id: number, value: AliasValue, now: Date): Promise<void> {
  await manager.update(CatalogIdentityAlias, { catalogIdentityId, id }, value);
  await touchIdentity(manager, catalogIdentityId, now);
}

export async function deleteAlias(manager: EntityManager, catalogIdentityId: number, id: number, now: Date): Promise<void> {
  await manager.delete(CatalogIdentityAlias, { catalogIdentityId, id });
  await touchIdentity(manager, catalogIdentityId, now);
}

export function hasNationality(manager: EntityManager, personId: number, countryId: number): Promise<boolean> {
  return manager.existsBy(PersonNationality, { personId, countryId });
}

export async function insertNationality(manager: EntityManager, personId: number, countryId: number, now: Date): Promise<void> {
  await manager.insert(PersonNationality, { personId, countryId });
  await touchIdentity(manager, personId, now);
}

export async function deleteNationality(manager: EntityManager, personId: number, countryId: number, now: Date): Promise<void> {
  await manager.delete(PersonNationality, { personId, countryId });
  await touchIdentity(manager, personId, now);
}

export function hasOrganizationType(manager: EntityManager, organizationId: number, organizationTypeId: number): Promise<boolean> {
  return manager.existsBy(OrganizationTypeAssignment, { organizationId, organizationTypeId });
}

export async function insertOrganizationType(manager: EntityManager, organizationId: number, organizationTypeId: number, now: Date): Promise<void> {
  await manager.insert(OrganizationTypeAssignment, { organizationId, organizationTypeId });
  await touchIdentity(manager, organizationId, now);
}

export async function deleteOrganizationType(manager: EntityManager, organizationId: number, organizationTypeId: number, now: Date): Promise<void> {
  await manager.delete(OrganizationTypeAssignment, { organizationId, organizationTypeId });
  await touchIdentity(manager, organizationId, now);
}

export async function findPlatformLink(manager: EntityManager, catalogIdentityId: number, id: number): Promise<PlatformLinkValue | null> {
  return platformLinkValue(await manager.findOneBy(CatalogIdentityPlatformLink, { catalogIdentityId, id }));
}

/** The link of an identity to the given URL on the given platform, which their uniqueness makes unambiguous. */
export async function findPlatformLinkByUrl(manager: EntityManager, catalogIdentityId: number, value: PlatformLinkValue): Promise<PlatformLinkValue | null> {
  return platformLinkValue(await manager.findOneBy(CatalogIdentityPlatformLink, { catalogIdentityId, ...value }));
}

/** What a platform link of an identity would break, besides the row it replaces: the uniqueness of its platform and URL. */
export async function platformLinkClashes(
  manager: EntityManager,
  catalogIdentityId: number,
  value: PlatformLinkValue,
  replacedId: number | null,
): Promise<string[]> {
  const others = replacedId === null ? {} : { id: Not(replacedId) };
  if (!(await manager.existsBy(CatalogIdentityPlatformLink, { catalogIdentityId, ...value, ...others }))) return [];
  return ['La identidad ya tiene este enlace en esa plataforma'];
}

export async function insertPlatformLink(manager: EntityManager, catalogIdentityId: number, value: PlatformLinkValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(CatalogIdentityPlatformLink, { catalogIdentityId, ...value, createdAt: now, updatedAt: now });
  await touchIdentity(manager, catalogIdentityId, now);
  return identifiers[0].id as number;
}

export async function updatePlatformLink(
  manager: EntityManager,
  catalogIdentityId: number,
  id: number,
  value: PlatformLinkValue,
  now: Date,
): Promise<void> {
  await manager.update(CatalogIdentityPlatformLink, { catalogIdentityId, id }, { ...value, updatedAt: now });
  await touchIdentity(manager, catalogIdentityId, now);
}

export async function deletePlatformLink(manager: EntityManager, catalogIdentityId: number, id: number, now: Date): Promise<void> {
  await manager.delete(CatalogIdentityPlatformLink, { catalogIdentityId, id });
  await touchIdentity(manager, catalogIdentityId, now);
}

function platformLinkValue(row: CatalogIdentityPlatformLink | null): PlatformLinkValue | null {
  return row && { platformId: row.platformId, url: row.url };
}

function aliasValue(row: CatalogIdentityAlias | null): AliasValue | null {
  return row && { alias: row.alias, isPrimary: row.isPrimary, sortOrder: row.sortOrder };
}

async function touchIdentity(manager: EntityManager, id: number, now: Date): Promise<void> {
  await manager.update(CatalogIdentity, { id }, { updatedAt: now });
}
