import { EntityManager } from 'typeorm';
import { CatalogIdentity, CatalogIdentityType, Organization, Person } from './entities/catalog-identity.entity';
import { IdentityCreationValue, PartialDateValue, findCreatedIdentity, partialDateColumns } from './identity-creations';

/*
 * The fields of a published identity that `set_fields` can change, which this
 * module owns. Each one is a column or a coherent group of columns, such as
 * the year, month and day of a partial date. The type of an identity, and so
 * its subtype, never changes.
 */

interface IdentityField {
  /** The identity type whose subtype holds the field; null for the fields of every identity. */
  type: CatalogIdentityType | null;
  /** The field's value inside the value of an identity, as `findCreatedIdentity` reads it. */
  pick(identity: IdentityCreationValue): unknown;
  /** The entity and columns that store a value of the field. */
  write: { entity: typeof CatalogIdentity | typeof Person | typeof Organization; columns(value: never): object };
}

const identityColumn = (column: 'displayName' | 'imgProfile' | 'bio'): IdentityField => ({
  type: null,
  pick: (identity) => identity[column],
  write: { entity: CatalogIdentity, columns: (value) => ({ [column]: value }) },
});

const personColumn = (column: keyof Person): IdentityField => ({
  type: 'person',
  pick: (identity) => identity.person![column as keyof IdentityCreationValue['person']],
  write: { entity: Person, columns: (value) => ({ [column]: value }) },
});

const organizationColumn = (column: 'legalName' | 'originCountryId'): IdentityField => ({
  type: 'organization',
  pick: (identity) => identity.organization![column],
  write: { entity: Organization, columns: (value) => ({ [column]: value }) },
});

const organizationDate = (prefix: 'founding' | 'dissolution'): IdentityField => ({
  type: 'organization',
  pick: (identity) => identity.organization![prefix],
  write: { entity: Organization, columns: (value: PartialDateValue | null) => partialDateColumns(prefix, value) },
});

export const IDENTITY_FIELDS = {
  'catalog_identities.display_name': identityColumn('displayName'),
  'catalog_identities.img_profile': identityColumn('imgProfile'),
  'catalog_identities.bio': identityColumn('bio'),
  'people.given_name': personColumn('givenName'),
  'people.family_name': personColumn('familyName'),
  'people.birth_date': personColumn('birthDate'),
  'people.death_date': personColumn('deathDate'),
  'people.height_cm': personColumn('heightCm'),
  'people.gender': personColumn('gender'),
  'organizations.legal_name': organizationColumn('legalName'),
  'organizations.founding': organizationDate('founding'),
  'organizations.dissolution': organizationDate('dissolution'),
  'organizations.origin_country_id': organizationColumn('originCountryId'),
} satisfies Record<string, IdentityField>;

export type IdentityFieldPath = keyof typeof IDENTITY_FIELDS;

/** Whether an identity of the given type has the field. */
export function hasIdentityField(type: CatalogIdentityType, path: IdentityFieldPath): boolean {
  const owner = (IDENTITY_FIELDS[path] as IdentityField).type;
  return owner === null || owner === type;
}

/** The value a field of an identity holds, picked from the identity's whole value. */
export function pickIdentityField(identity: IdentityCreationValue, path: IdentityFieldPath): unknown {
  return (IDENTITY_FIELDS[path] as IdentityField).pick(identity);
}

/**
 * Writes a field of the identity of an editorial root and returns the value it
 * holds afterwards. The caller checks first that the identity has the field.
 */
export async function writeIdentityField(
  manager: EntityManager,
  editorialEntityId: string,
  path: IdentityFieldPath,
  value: unknown,
  now: Date,
): Promise<unknown> {
  const identity = await manager.findOneByOrFail(CatalogIdentity, { editorialEntityId });
  const { entity, columns } = (IDENTITY_FIELDS[path] as IdentityField).write;
  const where = entity === CatalogIdentity ? { id: identity.id } : { catalogIdentityId: identity.id };
  await manager.update(entity, where, columns(value as never));
  await manager.update(CatalogIdentity, { id: identity.id }, { updatedAt: now });
  const written = await findCreatedIdentity(manager, editorialEntityId);
  return pickIdentityField(written!.value, path);
}
