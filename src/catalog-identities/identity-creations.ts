import { randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { CatalogIdentity, CatalogIdentityType, Organization, Person, PersonGender } from './entities/catalog-identity.entity';

/*
 * The writes of an identity's creation, which this module owns. The editorial
 * flow calls them inside the transaction that applies a `create_entity`, so
 * the domain rows, the decision and the revision commit together.
 */

export interface PartialDateValue {
  year: number;
  month?: number;
  day?: number;
}

/** The value of an identity's creation, as its payload proposes it and its revision records it. */
export interface IdentityCreationValue {
  type: CatalogIdentityType;
  displayName: string;
  imgProfile?: string | null;
  bio?: string | null;
  person?: {
    givenName?: string | null;
    familyName?: string | null;
    birthDate?: string | null;
    deathDate?: string | null;
    heightCm?: number | null;
    gender?: PersonGender | null;
  };
  organization?: {
    legalName?: string | null;
    founding?: PartialDateValue | null;
    dissolution?: PartialDateValue | null;
    originCountryId?: number | null;
  };
}

export interface CreatedIdentity {
  identity: CatalogIdentity;
  /** The value the rows hold, with every optional datum the payload left out as null. */
  value: IdentityCreationValue;
}

/** Inserts the identity of an editorial root and exactly the subtype its type names. */
export async function createIdentity(
  manager: EntityManager,
  editorialEntityId: string,
  creation: IdentityCreationValue,
  now: Date,
): Promise<CreatedIdentity> {
  const { identifiers } = await manager.insert(CatalogIdentity, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    displayName: creation.displayName,
    type: creation.type,
    imgProfile: creation.imgProfile ?? null,
    bio: creation.bio ?? null,
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  const catalogIdentityId = identifiers[0].id as number;
  if (creation.type === 'person') {
    const person = creation.person ?? {};
    await manager.insert(Person, {
      catalogIdentityId,
      givenName: person.givenName ?? null,
      familyName: person.familyName ?? null,
      birthDate: person.birthDate ?? null,
      deathDate: person.deathDate ?? null,
      heightCm: person.heightCm ?? null,
      gender: person.gender ?? null,
    });
  } else {
    const organization = creation.organization ?? {};
    await manager.insert(Organization, {
      catalogIdentityId,
      legalName: organization.legalName ?? null,
      ...partialDateColumns('founding', organization.founding),
      ...partialDateColumns('dissolution', organization.dissolution),
      originCountryId: organization.originCountryId ?? null,
    });
  }
  return (await findCreatedIdentity(manager, editorialEntityId))!;
}

/** The identity of an editorial root with the value of its creation, or null while it is only reserved. */
export async function findCreatedIdentity(manager: EntityManager, editorialEntityId: string): Promise<CreatedIdentity | null> {
  const identity = await manager.findOneBy(CatalogIdentity, { editorialEntityId });
  if (!identity) return null;
  const base = { type: identity.type, displayName: identity.displayName, imgProfile: identity.imgProfile, bio: identity.bio };
  if (identity.type === 'person') {
    const { catalogIdentityId: _, ...person } = await manager.findOneByOrFail(Person, { catalogIdentityId: identity.id });
    return { identity, value: { ...base, person } };
  }
  const organization = await manager.findOneByOrFail(Organization, { catalogIdentityId: identity.id });
  return {
    identity,
    value: {
      ...base,
      organization: {
        legalName: organization.legalName,
        founding: partialDateValue(organization.foundingYear, organization.foundingMonth, organization.foundingDay),
        dissolution: partialDateValue(organization.dissolutionYear, organization.dissolutionMonth, organization.dissolutionDay),
        originCountryId: organization.originCountryId,
      },
    },
  };
}

export function partialDateColumns(prefix: 'founding' | 'dissolution', date: PartialDateValue | null | undefined) {
  return {
    [`${prefix}Year`]: date?.year ?? null,
    [`${prefix}Month`]: date?.month ?? null,
    [`${prefix}Day`]: date?.day ?? null,
  };
}

function partialDateValue(year: number | null, month: number | null, day: number | null): PartialDateValue | null {
  if (year === null) return null;
  return { year, ...(month !== null ? { month } : {}), ...(day !== null ? { day } : {}) };
}

const PUBLIC_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const PUBLIC_ID_LENGTH = 21;

/** A random, URL-safe identifier of 21 characters (126 bits), as `public_id` columns hold. */
function newPublicId(): string {
  // 64 symbols, so each byte's low six bits pick one without bias.
  return [...randomBytes(PUBLIC_ID_LENGTH)].map((byte) => PUBLIC_ID_ALPHABET[byte & 63]).join('');
}
