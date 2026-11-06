import { EntityManager } from 'typeorm';
import { findDebut } from '../catalog-identities/artist-relations';
import { IdentityCreationValue, findCreatedIdentity } from '../catalog-identities/identity-creations';
import { IDENTITY_FIELDS, IdentityFieldPath, hasIdentityField, pickIdentityField, writeIdentityField } from '../catalog-identities/identity-fields';
import { BirthValue, PartialDateValue, datedBirth, isWhollyBefore } from '../common/partial-date/partial-date';
import { CATALOG_IMAGE_URL, ImageUrlReference, imageUrlAt } from '../images/catalog-image-urls';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import {
  BIO,
  BIRTH_DATE,
  COMPLETE_DATE,
  COUNTRY_ID,
  DISPLAY_NAME,
  GENDER,
  HEIGHT_CM,
  IMG_PROFILE,
  NAME,
  PARTIAL_DATE,
  partialDateProblems,
} from './identity-creation';
import { OperationDefinition, PayloadProblem, PublishedOperation, TargetProblem, VocabularyReference } from './operation-registry';

/*
 * `set_fields` of an identity: one field of a published identity, or a
 * coherent group of columns such as a partial date's year, month and day. The
 * value has the same shape as in the identity's creation.
 */

interface FieldRules {
  /** The version of the field's payload, 1 unless a change of shape published another. */
  version?: number;
  description: string;
  schema: object;
  check?(value: unknown): PayloadProblem[];
  references?(value: unknown): VocabularyReference[];
  imageUrls?(value: unknown): ImageUrlReference[];
  /** Rules against the identity's other fields and its artist's debut, as they are now. */
  consistency?(identity: IdentityCreationValue, value: unknown, debut: PartialDateValue | null): TargetProblem[];
}

const personDate = (field: 'birthDate' | 'deathDate'): Pick<FieldRules, 'check' | 'consistency'> => ({
  check: (value) => partialDateProblems(field, value as BirthValue | null),
  // A birthday has no year, so it compares with nothing.
  consistency: (identity, value, debut) => {
    const birth = datedBirth(field === 'birthDate' ? (value as BirthValue | null) : identity.person!.birthDate);
    const death = field === 'deathDate' ? (value as PartialDateValue | null) : identity.person!.deathDate;
    if (birth && death && isWhollyBefore(death, birth)) {
      return [inconsistent(field === 'birthDate' ? 'birthDate is after the current deathDate' : 'deathDate is before the current birthDate')];
    }
    if (field === 'birthDate' && birth && debut && isWhollyBefore(debut, birth)) {
      return [inconsistent('birthDate is after the current debut')];
    }
    return [];
  },
});

const partialDate = (field: 'founding' | 'dissolution'): Pick<FieldRules, 'check' | 'consistency'> => ({
  check: (value) => partialDateProblems(field, value as PartialDateValue | null),
  // Partial dates are intervals; only a dissolution wholly before the founding is impossible.
  consistency: (identity, value, debut) => {
    const founding = field === 'founding' ? (value as PartialDateValue | null) : identity.organization!.founding;
    const dissolution = field === 'dissolution' ? (value as PartialDateValue | null) : identity.organization!.dissolution;
    if (founding && dissolution && isWhollyBefore(dissolution, founding)) {
      return [inconsistent(field === 'founding' ? 'founding is after the current dissolution' : 'dissolution is before the current founding')];
    }
    if (field === 'founding' && founding && debut && isWhollyBefore(debut, founding)) {
      return [inconsistent('founding is after the current debut')];
    }
    return [];
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
    version: 2,
    description: 'Fecha parcial de nacimiento de una persona: año, mes y día cambian juntos; admite mes y día sin año, o null.',
    schema: BIRTH_DATE,
    ...personDate('birthDate'),
  },
  'people.birth_country_id': {
    description: 'País de nacimiento de una persona (el actual del lugar de nacimiento), o null.',
    schema: COUNTRY_ID,
    references: countryReference,
  },
  'people.death_date': {
    version: 2,
    description: 'Fecha parcial de fallecimiento de una persona: año, mes y día cambian juntos, o null.',
    schema: PARTIAL_DATE,
    ...personDate('deathDate'),
  },
  'people.height_cm': { description: 'Altura de una persona en centímetros, o null.', schema: HEIGHT_CM },
  'people.gender': { description: 'Género de una persona, o null.', schema: GENDER },
  'people.img_full_body': {
    description:
      'Foto de cuerpo completo de una persona, independiente de su altura: la URL de una imagen subida para el catálogo con POST /v1/images, o null.',
    schema: CATALOG_IMAGE_URL,
    imageUrls: (value) => imageUrlAt(value, '/value'),
  },
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
    payloadSchemaVersion: rules.version ?? 1,
    description: rules.description,
    valueSchema: rules.schema,
    targetKeySchema: null,
    check: (value) => rules.check?.(value) ?? [],
    references: (value) => rules.references?.(value) ?? [],
    imageUrls: (value) => rules.imageUrls?.(value) ?? [],
    targetProblems: async (manager, root, value) => {
      const created = await findCreatedIdentity(manager, root.id);
      if (!created) return [];
      if (!hasIdentityField(created.value.type, path)) {
        return [{ code: 'inapplicable_target', detail: `An identity of type ${created.value.type} has no ${path}`, member: 'targetPath' }];
      }
      return rules.consistency?.(created.value, value, await findDebut(manager, created.identity.id)) ?? [];
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

const completeDateV1 = (targetPath: string, description: string): PublishedOperation => ({
  entityType: 'identity',
  operation: 'set_fields',
  targetPath,
  payloadSchemaVersion: 1,
  description,
  valueSchema: COMPLETE_DATE,
  targetKeySchema: null,
});

/** Replaced by version 2 without a translation: the dates of a person became partial (ADR 0006). */
export const IDENTITY_FIELD_CHANGES_V1: PublishedOperation[] = [
  completeDateV1('people.birth_date', 'Fecha completa de nacimiento de una persona (`YYYY-MM-DD`), o null.'),
  completeDateV1('people.death_date', 'Fecha completa de fallecimiento de una persona (`YYYY-MM-DD`), o null.'),
];

async function currentIdentity(manager: EntityManager, root: EditorialEntity): Promise<IdentityCreationValue | null> {
  return (await findCreatedIdentity(manager, root.id))?.value ?? null;
}

function envelope(value: unknown): ValueEnvelope {
  return { exists: true, value: (value ?? null) as Extract<ValueEnvelope, { exists: true }>['value'] };
}

function inconsistent(detail: string): TargetProblem {
  return { code: 'inconsistent_value', detail, member: 'proposedValue/value' };
}
