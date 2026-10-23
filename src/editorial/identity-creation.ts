import { IdentityCreationValue as IdentityCreation, PartialDateValue as PartialDate, createIdentity, findCreatedIdentity } from '../catalog-identities/identity-creations';
import { CATALOG_IMAGE_URL, imageUrlAt } from '../images/catalog-image-urls';
import { OperationDefinition, PayloadProblem } from './operation-registry';

/*
 * `create_entity` of an identity: the minimal valid creation of a person or an
 * organization, with exactly the subtype its type names. Every other datum
 * (aliases, nationalities, categories, links, artist profile) is added by later
 * operations.
 */

export const NAME = { type: ['string', 'null'], maxLength: 200, pattern: '\\S' };
export const COMPLETE_DATE = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

export const PARTIAL_DATE = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['year'],
      properties: {
        year: { type: 'integer', minimum: 1, maximum: 9999 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        day: { type: 'integer', minimum: 1, maximum: 31 },
      },
      dependentRequired: { day: ['month'] },
    },
    { type: 'null' },
  ],
};

export const DISPLAY_NAME = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
export const IMG_PROFILE = CATALOG_IMAGE_URL;
export const BIO = { type: ['string', 'null'], maxLength: 10000 };
export const HEIGHT_CM = { type: ['integer', 'null'], minimum: 1, maximum: 300 };
export const GENDER = { enum: ['male', 'female', 'other', null] };
export const COUNTRY_ID = { type: ['integer', 'null'], minimum: 1, description: 'id del país en /v1/countries' };

const IDENTITY = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'displayName'],
  properties: {
    type: { enum: ['person', 'organization'] },
    displayName: DISPLAY_NAME,
    imgProfile: IMG_PROFILE,
    bio: BIO,
    person: {
      type: 'object',
      additionalProperties: false,
      properties: {
        givenName: NAME,
        familyName: NAME,
        birthDate: COMPLETE_DATE,
        deathDate: COMPLETE_DATE,
        heightCm: HEIGHT_CM,
        gender: GENDER,
      },
    },
    organization: {
      type: 'object',
      additionalProperties: false,
      properties: {
        legalName: NAME,
        founding: PARTIAL_DATE,
        dissolution: PARTIAL_DATE,
        originCountryId: COUNTRY_ID,
      },
    },
  },
  // Exactly the subtype the type names.
  allOf: [
    {
      if: { properties: { type: { const: 'person' } }, required: ['type'] },
      then: { required: ['person'], properties: { organization: false } },
    },
    {
      if: { properties: { type: { const: 'organization' } }, required: ['type'] },
      then: { required: ['organization'], properties: { person: false } },
    },
  ],
};

export const IDENTITY_CREATION: OperationDefinition = {
  entityType: 'identity',
  operation: 'create_entity',
  targetPath: 'catalog_identities',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una persona u organización: nombre visible, tipo y exactamente el subtipo de ese tipo. ' +
    'Las fechas de persona son completas; las de organización, parciales.',
  valueSchema: IDENTITY,
  targetKeySchema: null,
  check: (value) => checkIdentity(value as IdentityCreation),
  references: (value) => {
    const countryId = (value as IdentityCreation).organization?.originCountryId;
    return countryId == null ? [] : [{ vocabulary: 'countries', id: countryId, path: '/value/organization/originCountryId' }];
  },
  imageUrls: (value) => imageUrlAt((value as IdentityCreation).imgProfile, '/value/imgProfile'),
  read: async (manager, root) => {
    const created = await findCreatedIdentity(manager, root.id);
    return created ? { exists: true, value: created.value } : { exists: false };
  },
  apply: async (manager, root, value, now) => {
    const created = await createIdentity(manager, root.id, value as IdentityCreation, now);
    return {
      afterValue: { exists: true, value: created.value },
      resultKey: { id: created.identity.id, publicId: created.identity.publicId },
    };
  },
};

/** What the JSON Schema cannot say: real calendar dates and coherent intervals. */
function checkIdentity(identity: IdentityCreation): PayloadProblem[] {
  const problems: PayloadProblem[] = [];
  const { person, organization } = identity;
  if (person) {
    for (const field of ['birthDate', 'deathDate'] as const) {
      const date = person[field];
      if (date && !isCalendarDate(date)) problems.push({ path: `/value/person/${field}`, detail: `${field} is not a calendar date` });
    }
    if (person.birthDate && person.deathDate && person.deathDate < person.birthDate) {
      problems.push({ path: '/value/person/deathDate', detail: 'deathDate is before birthDate' });
    }
  }
  if (organization) {
    for (const field of ['founding', 'dissolution'] as const) {
      const date = organization[field];
      if (date?.day !== undefined && date.month !== undefined && date.day > daysInMonth(date.year, date.month)) {
        problems.push({ path: `/value/organization/${field}/day`, detail: `${field} is not a calendar date` });
      }
    }
    const { founding, dissolution } = organization;
    // Partial dates are intervals; only a dissolution wholly before the founding is impossible.
    if (founding && dissolution && interval(dissolution).last < interval(founding).first) {
      problems.push({ path: '/value/organization/dissolution', detail: 'dissolution is before founding' });
    }
  }
  return problems;
}

export function isCalendarDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The first and last days a partial date may mean, as comparable `YYYYMMDD` numbers. */
export function interval({ year, month, day }: PartialDate): { first: number; last: number } {
  const at = (m: number, d: number) => year * 10_000 + m * 100 + d;
  if (month === undefined) return { first: at(1, 1), last: at(12, 31) };
  if (day === undefined) return { first: at(month, 1), last: at(month, daysInMonth(year, month)) };
  return { first: at(month, day), last: at(month, day) };
}
