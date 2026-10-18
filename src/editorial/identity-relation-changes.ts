import { EntityManager } from 'typeorm';
import { CatalogIdentityType } from '../catalog-identities/entities/catalog-identity.entity';
import { findCreatedIdentity } from '../catalog-identities/identity-creations';
import {
  AliasValue,
  PlatformLinkValue,
  aliasClashes,
  deleteAlias,
  deleteNationality,
  deleteOrganizationType,
  deletePlatformLink,
  findAlias,
  findAliasByName,
  findPlatformLink,
  findPlatformLinkByUrl,
  hasNationality,
  hasOrganizationType,
  identityIdOf,
  insertAlias,
  insertNationality,
  insertOrganizationType,
  insertPlatformLink,
  platformLinkClashes,
  updateAlias,
  updatePlatformLink,
} from '../catalog-identities/identity-relations';
import { Platform } from '../vocabularies/entities/platform.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import type { OperationDefinition, RowKey, TargetProblem } from './operation-registry';

/*
 * Relation changes of an identity: its aliases and platform links, keyed by
 * their generated id, the nationalities of a person, keyed by person and
 * country, and the types of an organization, keyed by organization and type.
 * A target key names a row by its primary key, never by its position in a
 * list; see `row-references.ts` for the references a key may hold instead.
 */

export const INT4 = 2_147_483_647;
export const UUID = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };

export const reference = (member: 'change_id' | 'entity_id', description: string) => ({
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

export const ROW_KEY = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ROW_ID } };

const NATIONALITY_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['person_id', 'country_id'],
  properties: {
    person_id: reference('entity_id', 'Raíz editorial de la persona: la del microcambio'),
    country_id: { type: 'integer', minimum: 1, maximum: INT4, description: 'id del país en /v1/countries' },
  },
};

const ORGANIZATION_TYPE_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['organization_id', 'organization_type_id'],
  properties: {
    organization_id: reference('entity_id', 'Raíz editorial de la organización: la del microcambio'),
    organization_type_id: { type: 'integer', minimum: 1, maximum: INT4, description: 'id del tipo en /v1/organization-types' },
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

/** A nationality or an organization type has no data beyond its key. */
const KEY_ONLY = { type: 'object', additionalProperties: false, maxProperties: 0 };

// No play count: it is deferred beyond the MVP, so no write sets it.
const PLATFORM_LINK = {
  type: 'object',
  additionalProperties: false,
  required: ['platformId', 'url'],
  properties: {
    platformId: { type: 'integer', minimum: 1, maximum: INT4, description: 'id en /v1/platforms de una plataforma que admite identidades' },
    url: { type: 'string', maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' },
  },
};

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
  targetKeySchema: ROW_KEY,
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
  targetKeySchema: ROW_KEY,
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
  targetProblems: onlyFor('person', 'nationalities'),
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> =>
    key && (await hasNationality(manager, key.person_id, key.country_id)) ? KEY_ONLY_ROW : ABSENT,
} satisfies Partial<OperationDefinition>;

const ADD_NATIONALITY: OperationDefinition = {
  ...nationalityBase,
  operation: 'add_relation',
  description: 'Añade una nacionalidad documentada a una persona. Su clave es la persona y el país; el valor no lleva datos.',
  valueSchema: KEY_ONLY,
  apply: async (manager, _root, _value, now, key) => {
    await insertNationality(manager, key!.person_id, key!.country_id, now);
    return { afterValue: KEY_ONLY_ROW, resultKey: key };
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

const organizationTypeBase = {
  entityType: 'identity',
  targetPath: 'organization_type_assignments',
  payloadSchemaVersion: 1,
  targetKeySchema: ORGANIZATION_TYPE_KEY,
  ...noRules,
  keyReferences: (targetKey: object) => [
    { vocabulary: 'organization_types', id: (targetKey as RowKey).organization_type_id, path: '/organization_type_id' },
  ],
  targetProblems: onlyFor('organization', 'organization types'),
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> =>
    key && (await hasOrganizationType(manager, key.organization_id, key.organization_type_id)) ? KEY_ONLY_ROW : ABSENT,
} satisfies Partial<OperationDefinition>;

const ADD_ORGANIZATION_TYPE: OperationDefinition = {
  ...organizationTypeBase,
  operation: 'add_relation',
  description: 'Asigna un tipo a una organización, que puede tener varios. Su clave es la organización y el tipo; el valor no lleva datos.',
  valueSchema: KEY_ONLY,
  apply: async (manager, _root, _value, now, key) => {
    await insertOrganizationType(manager, key!.organization_id, key!.organization_type_id, now);
    return { afterValue: KEY_ONLY_ROW, resultKey: key };
  },
};

const REMOVE_ORGANIZATION_TYPE: OperationDefinition = {
  ...organizationTypeBase,
  operation: 'remove_relation',
  description: 'Quita un tipo de una organización.',
  valueSchema: null,
  apply: async (manager, _root, _value, now, key) => {
    await deleteOrganizationType(manager, key!.organization_id, key!.organization_type_id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

const platformLinkBase = {
  entityType: 'identity',
  targetPath: 'catalog_identity_platform_links',
  payloadSchemaVersion: 1,
  check: () => [],
} satisfies Partial<OperationDefinition>;

/** What a proposed link needs besides its schema: a platform that exists and supports identities. */
const proposedLinkRules = {
  references: (value: unknown) => [{ vocabulary: 'platforms', id: (value as PlatformLinkValue).platformId, path: '/value/platformId' }],
  // Run on the current vocabulary each time, as an administrator may change what a platform supports.
  targetProblems: async (manager: EntityManager, _root: EditorialEntity, value: unknown): Promise<TargetProblem[]> => {
    const platform = await manager.findOneBy(Platform, { id: (value as PlatformLinkValue).platformId });
    if (!platform || platform.supportsCatalogIdentity) return [];
    return [{ code: 'unsupported_platform', detail: `${platform.name} does not support identity links`, member: 'proposedValue/value/platformId' }];
  },
} satisfies Partial<OperationDefinition>;

const ADD_PLATFORM_LINK: OperationDefinition = {
  ...platformLinkBase,
  ...proposedLinkRules,
  operation: 'add_relation',
  description: 'Añade un enlace HTTP(S) de la identidad en una plataforma que admite identidades. Plataforma y URL son únicas en la identidad.',
  valueSchema: PLATFORM_LINK,
  targetKeySchema: null,
  naturalKey: (value) => {
    const { platformId, url } = (value ?? {}) as Partial<PlatformLinkValue>;
    return typeof platformId === 'number' && typeof url === 'string' ? { platformId, url } : undefined;
  },
  read: async (manager, root, _key, value) => {
    const identityId = await identityIdOf(manager, root.id);
    return identityId === null ? ABSENT : envelope(await findPlatformLinkByUrl(manager, identityId, value as PlatformLinkValue));
  },
  constraintProblems: async (manager, root, _key, value) =>
    platformLinkClashes(manager, (await identityIdOf(manager, root.id))!, value as PlatformLinkValue, null),
  apply: async (manager, root, value, now) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    const id = await insertPlatformLink(manager, identityId, value as PlatformLinkValue, now);
    return { afterValue: envelope(await findPlatformLink(manager, identityId, id)), resultKey: { id } };
  },
};

const UPDATE_PLATFORM_LINK: OperationDefinition = {
  ...platformLinkBase,
  ...proposedLinkRules,
  operation: 'update_relation',
  description: 'Sustituye la plataforma y la URL de un enlace existente de la identidad.',
  valueSchema: PLATFORM_LINK,
  targetKeySchema: ROW_KEY,
  read: (manager, root, key) => readPlatformLink(manager, root, key!),
  constraintProblems: async (manager, root, key, value) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    if (!(await findPlatformLink(manager, identityId, key!.id))) return ['El enlace ya no existe'];
    return platformLinkClashes(manager, identityId, value as PlatformLinkValue, key!.id);
  },
  apply: async (manager, root, value, now, key) => {
    const identityId = (await identityIdOf(manager, root.id))!;
    await updatePlatformLink(manager, identityId, key!.id, value as PlatformLinkValue, now);
    return { afterValue: envelope(await findPlatformLink(manager, identityId, key!.id)), resultKey: key };
  },
};

const REMOVE_PLATFORM_LINK: OperationDefinition = {
  ...platformLinkBase,
  operation: 'remove_relation',
  description: 'Quita un enlace de la identidad; la revisión guarda sus valores anteriores.',
  valueSchema: null,
  targetKeySchema: ROW_KEY,
  references: () => [],
  read: (manager, root, key) => readPlatformLink(manager, root, key!),
  apply: async (manager, root, _value, now, key) => {
    await deletePlatformLink(manager, (await identityIdOf(manager, root.id))!, key!.id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

export const IDENTITY_RELATION_CHANGES: OperationDefinition[] = [
  ADD_ALIAS,
  UPDATE_ALIAS,
  REMOVE_ALIAS,
  ADD_NATIONALITY,
  REMOVE_NATIONALITY,
  ADD_ORGANIZATION_TYPE,
  REMOVE_ORGANIZATION_TYPE,
  ADD_PLATFORM_LINK,
  UPDATE_PLATFORM_LINK,
  REMOVE_PLATFORM_LINK,
];

const KEY_ONLY_ROW: ValueEnvelope = { exists: true, value: {} };
// Not the registry's ABSENT: the registry imports this module.
const ABSENT: ValueEnvelope = { exists: false };

/** Reads the row of the root's identity that a key by generated id selects. */
function readRow(find: (manager: EntityManager, catalogIdentityId: number, id: number) => Promise<AliasValue | PlatformLinkValue | null>) {
  return async (manager: EntityManager, root: EditorialEntity, key: RowKey): Promise<ValueEnvelope> => {
    const identityId = await identityIdOf(manager, root.id);
    return identityId === null ? ABSENT : envelope(await find(manager, identityId, key.id));
  };
}

const readAlias = readRow(findAlias);
const readPlatformLink = readRow(findPlatformLink);

/** A relation that only an identity of the given type has. */
function onlyFor(type: CatalogIdentityType, relation: string) {
  return async (manager: EntityManager, root: EditorialEntity): Promise<TargetProblem[]> => {
    const created = await findCreatedIdentity(manager, root.id);
    if (!created || created.identity.type === type) return [];
    return [{ code: 'inapplicable_target', detail: `An identity of type ${created.identity.type} has no ${relation}`, member: 'targetPath' }];
  };
}

function envelope(row: AliasValue | PlatformLinkValue | null): ValueEnvelope {
  return row ? { exists: true, value: { ...row } } : ABSENT;
}
