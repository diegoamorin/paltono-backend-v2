import { EntityManager } from 'typeorm';
import {
  AffiliationValue,
  affiliationClashes,
  artistIdOf,
  artistReferences,
  deleteAffiliation,
  deleteArtist,
  findAffiliation,
  findAffiliationByStart,
  hasArtist,
  insertAffiliation,
  insertArtist,
  updateAffiliation,
} from '../catalog-identities/artist-relations';
import { AFFILIATION_RELATIONSHIP_TYPES, ASSOCIATION_STATUSES } from '../catalog-identities/entities/artist.entity';
import { findCreatedIdentity } from '../catalog-identities/identity-creations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { BIO, COMPLETE_DATE, isCalendarDate } from './identity-creation';
import { KEY_ONLY, KEY_ONLY_ROW, ROW_KEY, envelope, noRules, reference } from './identity-relation-changes';
import type { OperationDefinition, PayloadProblem, RowKey, TargetProblem } from './operation-registry';

/*
 * The artist profile of an identity and its affiliations.
 *
 * The profile is a component of its root, keyed by the identity itself, so an
 * identity has at most one. A profile something still refers to cannot be
 * removed.
 */

const ARTIST_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['catalog_identity_id'],
  properties: { catalog_identity_id: reference('entity_id', 'Raíz editorial de la identidad: la del microcambio') },
};

const ABSENT: ValueEnvelope = { exists: false };

const artistBase = {
  entityType: 'identity',
  targetPath: 'artists',
  payloadSchemaVersion: 1,
  targetKeySchema: ARTIST_KEY,
  ...noRules,
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> =>
    key && (await hasArtist(manager, key.catalog_identity_id)) ? KEY_ONLY_ROW : ABSENT,
} satisfies Partial<OperationDefinition>;

const ADD_ARTIST: OperationDefinition = {
  ...artistBase,
  operation: 'add_relation',
  description: 'Añade el perfil artístico de la identidad, que tiene como mucho uno. Su clave es la identidad; el valor no lleva datos.',
  valueSchema: KEY_ONLY,
  apply: async (manager, _root, _value, now, key) => {
    await insertArtist(manager, key!.catalog_identity_id, now);
    return { afterValue: KEY_ONLY_ROW, resultKey: key };
  },
};

const REMOVE_ARTIST: OperationDefinition = {
  ...artistBase,
  operation: 'remove_relation',
  description: 'Quita el perfil artístico de la identidad. Un perfil al que todavía se refieren afiliaciones o créditos no se puede quitar.',
  valueSchema: null,
  targetProblems: async (manager, root) =>
    (await referencesOf(manager, root)).map((detail) => ({ code: 'artist_referenced', detail, member: 'targetKey' })),
  constraintProblems: (manager, root) => referencesOf(manager, root),
  apply: async (manager, _root, _value, now, key) => {
    await deleteArtist(manager, key!.catalog_identity_id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

async function referencesOf(manager: EntityManager, root: EditorialEntity): Promise<string[]> {
  const identityId = await identityIdOf(manager, root.id);
  return identityId === null ? [] : artistReferences(manager, identityId);
}

/*
 * Affiliations of an artist with an agency, a label or management, keyed by
 * their generated id. They belong to the artist's identity root; the
 * organization is named by its editorial UUID and locked with it, and the
 * list of an organization's artists is derived from them.
 */

const AFFILIATION = {
  type: 'object',
  additionalProperties: false,
  required: ['organization', 'relationshipType', 'startedAt', 'endedAt', 'status', 'description'],
  properties: {
    organization: reference('entity_id', 'Raíz editorial de la organización: otra identidad de tipo organization'),
    relationshipType: { enum: AFFILIATION_RELATIONSHIP_TYPES },
    startedAt: COMPLETE_DATE,
    endedAt: COMPLETE_DATE,
    status: { enum: ASSOCIATION_STATUSES, description: 'Un fin conocido exige former; current exige fin desconocido' },
    description: BIO,
  },
};

const proposedAffiliationRules = {
  check: (value: unknown) => checkAffiliation(value as AffiliationValue),
  references: () => [],
  rootReferences: (value: unknown) => {
    const organization = (value as Partial<AffiliationValue> | undefined)?.organization?.entity_id;
    return typeof organization === 'string' ? [{ entityId: organization, entityType: 'identity' as const, path: '/value/organization' }] : [];
  },
  targetProblems: async (manager: EntityManager, root: EditorialEntity, value: unknown): Promise<TargetProblem[]> => {
    const problems: TargetProblem[] = [];
    const identityId = await identityIdOf(manager, root.id);
    if (identityId === null || !(await hasArtist(manager, identityId))) {
      problems.push({ code: 'no_artist_profile', detail: 'Only an identity with an artist profile has affiliations', member: 'entity' });
    }
    // A reservation's type is checked once its creation applies, as every decision runs these rules again.
    const organization = await findCreatedIdentity(manager, (value as AffiliationValue).organization.entity_id.toLowerCase());
    if (organization && organization.identity.type !== 'organization') {
      problems.push({ code: 'not_an_organization', detail: 'An affiliation names an organization', member: 'proposedValue/value/organization' });
    }
    return problems;
  },
} satisfies Partial<OperationDefinition>;

const affiliationBase = {
  entityType: 'identity',
  targetPath: 'artist_organization_affiliations',
  payloadSchemaVersion: 1,
} satisfies Partial<OperationDefinition>;

const ADD_AFFILIATION: OperationDefinition = {
  ...affiliationBase,
  ...proposedAffiliationRules,
  operation: 'add_relation',
  description:
    'Añade una afiliación informativa del artista con una agencia, un sello o su management, sin autoafiliación. ' +
    'Organización, tipo y fecha de inicio son únicos en el artista.',
  valueSchema: AFFILIATION,
  targetKeySchema: null,
  naturalKey: (value) => {
    const { organization, relationshipType, startedAt } = (value ?? {}) as Partial<AffiliationValue>;
    return organization && relationshipType && startedAt !== undefined ? { organization, relationshipType, startedAt } : undefined;
  },
  read: async (manager, root, _key, value) => {
    const ids = await affiliationIds(manager, root, value as AffiliationValue);
    return ids ? envelope(await findAffiliationByStart(manager, ids.artistId, ids.organizationId, value as AffiliationValue)) : ABSENT;
  },
  constraintProblems: async (manager, root, _key, value) => {
    const ids = await affiliationIds(manager, root, value as AffiliationValue);
    if (!ids) return ['La identidad ya no tiene perfil artístico'];
    return affiliationClashes(manager, ids.artistId, ids.organizationId, value as AffiliationValue, null);
  },
  apply: async (manager, root, value, now) => {
    const { artistId, organizationId } = (await affiliationIds(manager, root, value as AffiliationValue))!;
    const id = await insertAffiliation(manager, artistId, organizationId, value as AffiliationValue, now);
    return { afterValue: envelope(await findAffiliation(manager, artistId, id)), resultKey: { id } };
  },
};

const UPDATE_AFFILIATION: OperationDefinition = {
  ...affiliationBase,
  ...proposedAffiliationRules,
  operation: 'update_relation',
  description: 'Sustituye los datos de una afiliación existente del artista.',
  valueSchema: AFFILIATION,
  targetKeySchema: ROW_KEY,
  read: (manager, root, key) => readAffiliation(manager, root, key!),
  constraintProblems: async (manager, root, key, value) => {
    const ids = await affiliationIds(manager, root, value as AffiliationValue);
    if (!ids || !(await findAffiliation(manager, ids.artistId, key!.id))) return ['La afiliación ya no existe'];
    return affiliationClashes(manager, ids.artistId, ids.organizationId, value as AffiliationValue, key!.id);
  },
  apply: async (manager, root, value, now, key) => {
    const { artistId, organizationId } = (await affiliationIds(manager, root, value as AffiliationValue))!;
    await updateAffiliation(manager, artistId, key!.id, organizationId, value as AffiliationValue, now);
    return { afterValue: envelope(await findAffiliation(manager, artistId, key!.id)), resultKey: key };
  },
};

const REMOVE_AFFILIATION: OperationDefinition = {
  ...affiliationBase,
  operation: 'remove_relation',
  description: 'Quita una afiliación del artista; la revisión guarda sus valores anteriores.',
  valueSchema: null,
  targetKeySchema: ROW_KEY,
  ...noRules,
  read: (manager, root, key) => readAffiliation(manager, root, key!),
  apply: async (manager, root, _value, now, key) => {
    const artistId = (await artistIdOf(manager, (await identityIdOf(manager, root.id))!))!;
    await deleteAffiliation(manager, artistId, key!.id, now);
    return { afterValue: ABSENT, resultKey: key };
  },
};

export const ARTIST_CHANGES: OperationDefinition[] = [
  ADD_ARTIST,
  REMOVE_ARTIST,
  ADD_AFFILIATION,
  UPDATE_AFFILIATION,
  REMOVE_AFFILIATION,
];

/** Reads the affiliation of the root's artist that a key by generated id selects. */
async function readAffiliation(manager: EntityManager, root: EditorialEntity, key: RowKey): Promise<ValueEnvelope> {
  const identityId = await identityIdOf(manager, root.id);
  const artistId = identityId === null ? null : await artistIdOf(manager, identityId);
  return artistId === null ? ABSENT : envelope(await findAffiliation(manager, artistId, key.id));
}

/** The domain ids of the root's artist and of the organization, or null while either does not exist. */
async function affiliationIds(
  manager: EntityManager,
  root: EditorialEntity,
  value: AffiliationValue,
): Promise<{ artistId: number; organizationId: number } | null> {
  const identityId = await identityIdOf(manager, root.id);
  const artistId = identityId === null ? null : await artistIdOf(manager, identityId);
  const organizationId = await identityIdOf(manager, value.organization.entity_id.toLowerCase());
  return artistId === null || organizationId === null ? null : { artistId, organizationId };
}

/** What the JSON Schema cannot say: calendar dates, an end after the start and a status coherent with it. */
function checkAffiliation({ startedAt, endedAt, status }: AffiliationValue): PayloadProblem[] {
  const problems: PayloadProblem[] = [];
  for (const [field, date] of [['startedAt', startedAt], ['endedAt', endedAt]] as const) {
    if (date && !isCalendarDate(date)) problems.push({ path: `/value/${field}`, detail: `${field} is not a calendar date` });
  }
  if (endedAt && status !== 'former') {
    problems.push({ path: '/value/status', detail: 'A known end requires status former' });
  } else if (startedAt && endedAt && endedAt < startedAt) {
    problems.push({ path: '/value/endedAt', detail: 'endedAt is before startedAt' });
  }
  return problems;
}
