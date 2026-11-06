import { IdentityCreationValue as IdentityCreation, createIdentity, findCreatedIdentity } from '../catalog-identities/identity-creations';
import { BirthValue, datedBirth, isRealDay, isWhollyBefore } from '../common/partial-date/partial-date';
import { CATALOG_IMAGE_URL, imageUrlAt } from '../images/catalog-image-urls';
import { OperationDefinition, PayloadProblem, PublishedOperation } from './operation-registry';

/*
 * `create_entity` of an identity: the minimal valid creation of a person or an
 * organization, with exactly the subtype its type names. Every other datum
 * (aliases, nationalities, categories, links, artist profile) is added by later
 * operations.
 */

export const NAME = { type: ['string', 'null'], maxLength: 200, pattern: '\\S' };
export const COMPLETE_DATE = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

const MONTH = { type: 'integer', minimum: 1, maximum: 12 };
const DAY = { type: 'integer', minimum: 1, maximum: 31 };

const DATE_WITH_YEAR = {
  type: 'object',
  additionalProperties: false,
  required: ['year'],
  properties: {
    year: { type: 'integer', minimum: 1, maximum: 9999 },
    month: MONTH,
    day: DAY,
  },
  dependentRequired: { day: ['month'] },
};

export const PARTIAL_DATE = { anyOf: [DATE_WITH_YEAR, { type: 'null' }] };

/** A partial date, or a birthday: a month and a day without a year. */
export const BIRTH_DATE = {
  anyOf: [
    DATE_WITH_YEAR,
    { type: 'object', additionalProperties: false, required: ['month', 'day'], properties: { month: MONTH, day: DAY } },
    { type: 'null' },
  ],
};

export const DISPLAY_NAME = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
export const IMG_PROFILE = CATALOG_IMAGE_URL;
export const BIO = { type: ['string', 'null'], maxLength: 10000 };
export const HEIGHT_CM = { type: ['integer', 'null'], minimum: 1, maximum: 300 };
export const GENDER = { enum: ['male', 'female', 'other', null] };
export const COUNTRY_ID = { type: ['integer', 'null'], minimum: 1, description: 'id del país en /v1/countries' };

const identitySchema = (birthDate: object, deathDate: object) => ({
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
        birthDate,
        birthCountryId: COUNTRY_ID,
        deathDate,
        heightCm: HEIGHT_CM,
        gender: GENDER,
        imgFullBody: CATALOG_IMAGE_URL,
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
});

/** Replaced by version 2 without a translation: the dates of a person became partial (ADR 0006). */
export const IDENTITY_CREATION_V1: PublishedOperation = {
  entityType: 'identity',
  operation: 'create_entity',
  targetPath: 'catalog_identities',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una persona u organización: nombre visible, tipo y exactamente el subtipo de ese tipo. ' +
    'Las fechas de persona son completas; las de organización, parciales.',
  valueSchema: identitySchema(COMPLETE_DATE, COMPLETE_DATE),
  targetKeySchema: null,
};

export const IDENTITY_CREATION: OperationDefinition = {
  entityType: 'identity',
  operation: 'create_entity',
  targetPath: 'catalog_identities',
  payloadSchemaVersion: 2,
  description:
    'Alta mínima de una persona u organización: nombre visible, tipo y exactamente el subtipo de ese tipo. ' +
    'Las fechas son parciales, y el nacimiento admite además mes y día sin año.',
  valueSchema: identitySchema(BIRTH_DATE, PARTIAL_DATE),
  targetKeySchema: null,
  check: (value) => checkIdentity(value as IdentityCreation),
  references: (value) => {
    const { person, organization } = value as IdentityCreation;
    const countries = [
      { id: person?.birthCountryId, path: '/value/person/birthCountryId' },
      { id: organization?.originCountryId, path: '/value/organization/originCountryId' },
    ];
    return countries.flatMap(({ id, path }) => (id == null ? [] : [{ vocabulary: 'countries' as const, id, path }]));
  },
  imageUrls: (value) => {
    const { imgProfile, person } = value as IdentityCreation;
    return [...imageUrlAt(imgProfile, '/value/imgProfile'), ...imageUrlAt(person?.imgFullBody, '/value/person/imgFullBody')];
  },
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
      problems.push(...partialDateProblems(field, person[field], `/value/person/${field}`));
    }
    const birth = datedBirth(person.birthDate);
    if (birth && person.deathDate && isWhollyBefore(person.deathDate, birth)) {
      problems.push({ path: '/value/person/deathDate', detail: 'deathDate is before birthDate' });
    }
  }
  if (organization) {
    for (const field of ['founding', 'dissolution'] as const) {
      problems.push(...partialDateProblems(field, organization[field], `/value/organization/${field}`));
    }
    const { founding, dissolution } = organization;
    // Partial dates are intervals; only a dissolution wholly before the founding is impossible.
    if (founding && dissolution && isWhollyBefore(dissolution, founding)) {
      problems.push({ path: '/value/organization/dissolution', detail: 'dissolution is before founding' });
    }
  }
  return problems;
}

/** A partial date whose day does not exist in its month, which the JSON Schema cannot say. */
export function partialDateProblems(field: string, date: BirthValue | null | undefined, at = '/value'): PayloadProblem[] {
  if (!date || isRealDay(date)) return [];
  return [{ path: `${at}/day`, detail: `${field} is not a calendar date` }];
}

export function isCalendarDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && isRealDay({ year, month, day });
}
