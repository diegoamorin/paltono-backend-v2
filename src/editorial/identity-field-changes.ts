import { EntityManager } from 'typeorm';
import { IdentityCreationValue, PartialDateValue as PartialDate, findCreatedIdentity } from '../catalog-identities/identity-creations';
import { IDENTITY_FIELDS, IdentityFieldPath, hasIdentityField, pickIdentityField, writeIdentityField } from '../catalog-identities/identity-fields';
import { ImageUrlReference, imageUrlAt } from '../images/catalog-image-urls';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import {
  BIO,
  COMPLETE_DATE,
  COUNTRY_ID,
  DISPLAY_NAME,
  GENDER,
  HEIGHT_CM,
  IMG_PROFILE,
  NAME,
  PARTIAL_DATE,
  daysInMonth,
  interval,
  isCalendarDate,
} from './identity-creation';
import { OperationDefinition, PayloadProblem, TargetProblem, VocabularyReference } from './operation-registry';

/*
 * `set_fields` of an identity: one field of a published identity, or a
 * coherent group of columns such as a partial date's year, month and day. The
 * value has the same shape as in the identity's creation.
 */

interface FieldRules {
  description: string;
  schema: object;
  check?(value: unknown): PayloadProblem[];
  references?(value: unknown): VocabularyReference[];
  imageUrls?(value: unknown): ImageUrlReference[];
  /** Rules against the identity's other fields, as they are now. */
  consistency?(identity: IdentityCreationValue, value: unknown): TargetProblem[];
}

const completeDate = (field: 'birthDate' | 'deathDate'): Pick<FieldRules, 'check' | 'consistency'> => ({
  check: (value) => (typeof value === 'string' && !isCalendarDate(value) ? [{ path: '/value', detail: `${field} is not a calendar date` }] : []),
  consistency: (identity, value) => {
    const birthDate = field === 'birthDate' ? value : identity.person!.birthDate;
    const deathDate = field === 'deathDate' ? value : identity.person!.deathDate;
    if (typeof birthDate !== 'string' || typeof deathDate !== 'string' || deathDate >= birthDate) return [];
    return [inconsistent(field === 'birthDate' ? 'birthDate is after the current deathDate' : 'deathDate is before the current birthDate')];
  },
});

const partialDate = (field: 'founding' | 'dissolution'): Pick<FieldRules, 'check' | 'consistency'> => ({
  check: (value) => {
    const date = value as PartialDate | null;
    if (date?.day === undefined || date.month === undefined || date.day <= daysInMonth(date.year, date.month)) return [];
    return [{ path: '/value/day', detail: `${field} is not a calendar date` }];
  },
  // Partial dates are intervals; only a dissolution wholly before the founding is impossible.
  consistency: (identity, value) => {
    const founding = field === 'founding' ? (value as PartialDate | null) : identity.organization!.founding;
    const dissolution = field === 'dissolution' ? (value as PartialDate | null) : identity.organization!.dissolution;
    if (!founding || !dissolution || interval(dissolution).last >= interval(founding).first) return [];
    return [inconsistent(field === 'founding' ? 'founding is after the current dissolution' : 'dissolution is before the current founding')];
  },
});

const countryReference = (value: unknown): VocabularyReference[] =>
  typeof value === 'number' ? [{ vocabulary: 'countries', id: value, path: '/value' }] : [];

const FIELD_RULES: Record<IdentityFieldPath, FieldRules> = {
  'catalog_identities.display_name': { description: 'Nombre visible de la identidad.', schema: DISPLAY_NAME },
  'catalog_identities.img_profile': {
    description: 'Imagen de perfil: la URL de una imagen subida para el catálogo con POST /v1/images, o null.',
    schema: IMG_PROFILE,
    imageUrls: (value) => imageUrlAt(value, '/value'),
  },
  'catalog_identities.bio': { description: 'Biografía, o null.', schema: BIO },
  'people.given_name': { description: 'Nombre de pila de una persona.', schema: NAME },
  'people.family_name': { description: 'Apellido de una persona.', schema: NAME },
  'people.birth_date': {
    description: 'Fecha completa de nacimiento de una persona (`YYYY-MM-DD`), o null.',
    schema: COMPLETE_DATE,
    ...completeDate('birthDate'),
  },
  'people.birth_country_id': {
    description: 'País de nacimiento de una persona (el actual del lugar de nacimiento), o null.',
    schema: COUNTRY_ID,
    references: countryReference,
  },
  'people.death_date': {
    description: 'Fecha completa de fallecimiento de una persona (`YYYY-MM-DD`), o null.',
    schema: COMPLETE_DATE,
    ...completeDate('deathDate'),
  },
  'people.height_cm': { description: 'Altura de una persona en centímetros, o null.', schema: HEIGHT_CM },
  'people.gender': { description: 'Género de una persona, o null.', schema: GENDER },
  'organizations.legal_name': { description: 'Razón social de una organización.', schema: NAME },
  'organizations.founding': {
    description: 'Fecha parcial de fundación de una organización: año, mes y día cambian juntos.',
    schema: PARTIAL_DATE,
    ...partialDate('founding'),
  },
  'organizations.dissolution': {
    description: 'Fecha parcial de disolución de una organización: año, mes y día cambian juntos.',
    schema: PARTIAL_DATE,
    ...partialDate('dissolution'),
  },
  'organizations.origin_country_id': {
    description: 'País de origen de una organización, o null.',
    schema: COUNTRY_ID,
    references: countryReference,
  },
};

export const IDENTITY_FIELD_CHANGES: OperationDefinition[] = (Object.keys(IDENTITY_FIELDS) as IdentityFieldPath[]).map((path) => {
  const rules = FIELD_RULES[path];
  return {
    entityType: 'identity',
    operation: 'set_fields',
    targetPath: path,
    payloadSchemaVersion: 1,
    description: rules.description,
    valueSchema: rules.schema,
    targetKeySchema: null,
    check: (value) => rules.check?.(value) ?? [],
    references: (value) => rules.references?.(value) ?? [],
    imageUrls: (value) => rules.imageUrls?.(value) ?? [],
    targetProblems: async (manager, root, value) => {
      const identity = await currentIdentity(manager, root);
      if (!identity) return [];
      if (!hasIdentityField(identity.type, path)) {
        return [{ code: 'inapplicable_target', detail: `An identity of type ${identity.type} has no ${path}`, member: 'targetPath' }];
      }
      return rules.consistency?.(identity, value) ?? [];
    },
    read: async (manager, root) => {
      const identity = await currentIdentity(manager, root);
      if (!identity || !hasIdentityField(identity.type, path)) return { exists: false };
      return envelope(pickIdentityField(identity, path));
    },
    apply: async (manager, root, value, now) => ({
      afterValue: envelope(await writeIdentityField(manager, root.id, path, value, now)),
      resultKey: null,
    }),
  };
});

async function currentIdentity(manager: EntityManager, root: EditorialEntity): Promise<IdentityCreationValue | null> {
  return (await findCreatedIdentity(manager, root.id))?.value ?? null;
}

function envelope(value: unknown): ValueEnvelope {
  return { exists: true, value: (value ?? null) as Extract<ValueEnvelope, { exists: true }>['value'] };
}

function inconsistent(detail: string): TargetProblem {
  return { code: 'inconsistent_value', detail, member: 'proposedValue/value' };
}
