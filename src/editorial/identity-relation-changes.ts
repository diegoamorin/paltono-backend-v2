import { EntityManager } from 'typeorm';
import { findCreatedIdentity } from '../catalog-identities/identity-creations';
import {
  AliasValue,
  aliasClashes,
  deleteAlias,
  deleteNationality,
  findAlias,
  findAliasByName,
  hasNationality,
  identityIdOf,
  insertAlias,
  insertNationality,
  updateAlias,
} from '../catalog-identities/identity-relations';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import type { OperationDefinition, RowKey } from './operation-registry';

/*
 * Relation changes of an identity: its aliases, keyed by their generated id,
 * and the nationalities of a person, keyed by person and country. A target key
 * names a row by its primary key, never by its position in a list; see
 * `row-references.ts` for the references a key may hold instead.
 */

const INT4 = 2_147_483_647;
const UUID = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };

const reference = (member: 'change_id' | 'entity_id', description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: [member],
  properties: { [member]: UUID },
  description,
});

const ROW_ID = {
  anyOf: [
    { type: 'integer', minimum: 1, maximum: INT4 },
    reference('change_id', 'Inserción de este envío que creará la fila, mientras no existe'),
  ],
};

const ALIAS_KEY = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ROW_ID } };

const NATIONALITY_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['person_id', 'country_id'],
  properties: {
    person_id: reference('entity_id', 'Raíz editorial de la persona: la del microcambio'),
    country_id: { type: 'integer', minimum: 1, maximum: INT4, description: 'id del país en /v1/countries' },
  },
};

const ALIAS = {
  type: 'object',
  additionalProperties: false,
  required: ['alias', 'isPrimary', 'sortOrder'],
  properties: {
    alias: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    isPrimary: { type: 'boolean' },
    sortOrder: { type: 'integer', minimum: 0, maximum: 32767 },
  },
};

/** A nationality has no data beyond its key. */
const NATIONALITY = { type: 'object', additionalProperties: false, maxProperties: 0 };

const noRules = { check: () => [], references: () => [] } satisfies Pick<OperationDefinition, 'check' | 'references'>;

const aliasBase = {
  entityType: 'identity',
  targetPath: 'catalog_identity_aliases',
  payloadSchemaVersion: 1,
  ...noRules,
} satisfies Partial<OperationDefinition>;

const ADD_ALIAS: OperationDefinition = {
  ...aliasBase,
  operation: 'add_relation',
  description: 'Añade un alias a la identidad. Su spelling es único en la identidad y como mucho uno es primario.',
  valueSchema: ALIAS,
  targetKeySchema: null,
  naturalKey: (value) => {
    const spelling = (value as Partial<AliasValue> | undefined)?.alias;
    return typeof spelling === 'string' ? { alias: spelling } : undefined;
  },
  read: async (manager, root, _key, value) => {
    const identityId = await identityIdOf(manager, root.id);
    return identityId === null ? ABSENT : envelope(await findAliasByName(manager, identityId, (value as AliasValue).alias));
  },
  constraintProblems: async (manager, root, _key, value) => aliasClashes(manager, (await identityIdOf(manager, root.id))!, value as AliasValue, null),
  apply: async (manager, root, value, now) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    const id = await insertAlias(manager, identityId, value as AliasValue, now);
    return { afterValue: envelope(await findAlias(manager, identityId, id)), resultKey: { id } };
  },
};

const UPDATE_ALIAS: OperationDefinition = {
  ...aliasBase,
  operation: 'update_relation',
  description: 'Sustituye los datos de un alias existente de la identidad.',
  valueSchema: ALIAS,
  targetKeySchema: ALIAS_KEY,
  read: (manager, root, key) => readAlias(manager, root, key!),
  constraintProblems: async (manager, root, key, value) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    if (!(await findAlias(manager, identityId, key!.id))) return ['El alias ya no existe'];
    return aliasClashes(manager, identityId, value as AliasValue, key!.id);
  },
  apply: async (manager, root, value, now, key) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    await updateAlias(manager, identityId, key!.id, value as AliasValue, now);
    return { afterValue: envelope(await findAlias(manager, identityId, key!.id)), resultKey: key };
  },
};

const REMOVE_ALIAS: OperationDefinition = {
  ...aliasBase,
  operation: 'remove_relation',
  description: 'Quita un alias de la identidad; la revisión guarda sus valores anteriores.',
  valueSchema: null,
  targetKeySchema: ALIAS_KEY,
  read: (manager, root, key) => readAlias(manager, root, key!),
  apply: async (manager, root, _value, now, key) => {
    await deleteAlias(manager, (await identityIdOf(manager, root.id))!, key!.id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

const nationalityBase = {
  entityType: 'identity',
  targetPath: 'person_nationalities',
  payloadSchemaVersion: 1,
  targetKeySchema: NATIONALITY_KEY,
  ...noRules,
  keyReferences: (targetKey: object) => [{ vocabulary: 'countries', id: (targetKey as RowKey).country_id, path: '/country_id' }],
  targetProblems: async (manager: EntityManager, root: EditorialEntity) => {
    const created = await findCreatedIdentity(manager, root.id);
    if (!created || created.identity.type === 'person') return [];
    return [{ code: 'inapplicable_target', detail: `An identity of type ${created.identity.type} has no nationalities`, member: 'targetPath' }];
  },
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> =>
    key && (await hasNationality(manager, key.person_id, key.country_id)) ? NATIONALITY_ROW : ABSENT,
} satisfies Partial<OperationDefinition>;

const ADD_NATIONALITY: OperationDefinition = {
  ...nationalityBase,
  operation: 'add_relation',
  description: 'Añade una nacionalidad documentada a una persona. Su clave es la persona y el país; el valor no lleva datos.',
  valueSchema: NATIONALITY,
  apply: async (manager, _root, _value, now, key) => {
    await insertNationality(manager, key!.person_id, key!.country_id, now);
    return { afterValue: NATIONALITY_ROW, resultKey: key };
  },
};

const REMOVE_NATIONALITY: OperationDefinition = {
  ...nationalityBase,
  operation: 'remove_relation',
  description: 'Quita una nacionalidad de una persona.',
  valueSchema: null,
  apply: async (manager, _root, _value, now, key) => {
    await deleteNationality(manager, key!.person_id, key!.country_id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

export const IDENTITY_RELATION_CHANGES: OperationDefinition[] = [ADD_ALIAS, UPDATE_ALIAS, REMOVE_ALIAS, ADD_NATIONALITY, REMOVE_NATIONALITY];

const NATIONALITY_ROW: ValueEnvelope = { exists: true, value: {} };
// Not the registry's ABSENT: the registry imports this module.
const ABSENT: ValueEnvelope = { exists: false };

async function readAlias(manager: EntityManager, root: EditorialEntity, key: RowKey): Promise<ValueEnvelope> {
  const identityId = await identityIdOf(manager, root.id);
  return identityId === null ? ABSENT : envelope(await findAlias(manager, identityId, key.id));
}

function envelope(row: AliasValue | null): ValueEnvelope {
  return row ? { exists: true, value: { ...row } } : ABSENT;
}
