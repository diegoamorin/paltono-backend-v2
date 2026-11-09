import { EntityManager } from 'typeorm';
import { hasArtist } from '../catalog-identities/artist-relations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { ARTIST_CREDIT_RANKS } from '../music/entities/recording.entity';
import { artistIdOfIdentity } from '../music/releases';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { reference } from './identity-relation-changes';
import type { KeyRow, OperationDefinition, RowKey, TargetProblem } from './operation-registry';

/*
 * Relation changes of an artist credit (ADR 0008): the artists a release
 * group, a recording or a track is credited to, in order. A credit is keyed
 * by its owner and the artist, whose profile has no root of its own: the key
 * names the artist's identity by its editorial UUID, checked like any other
 * root a change names. They do not credit authorship, performance or
 * production.
 */

const ABSENT: ValueEnvelope = { exists: false };

const ARTIST_ID = reference('entity_id', 'Raíz editorial de la identidad del artista: publicada, o creada en la misma propuesta, con perfil artístico');

/** The value of an artist credit; `rankOf` names what a rank is unique for ("grabación"), or omits the rank. */
export function artistCreditValue(rankOf?: string): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: rankOf ? ['rank', 'position'] : ['position'],
    properties: {
      ...(rankOf && { rank: { enum: ARTIST_CREDIT_RANKS, description: `\`main\`, \`featured\` o \`remixer\`; una por artista y ${rankOf}` } }),
      position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden de presentación' },
      creditedAs: { type: ['string', 'null'], maxLength: 200, pattern: '\\S', description: 'Nombre literal de la fuente; null muestra el nombre visible' },
    },
  };
}

/** The identity a credit's key names has an artist profile, once it is created: a reservation's is checked after its creation applies. */
async function artistProblems(manager: EntityManager, targetKey: object | null): Promise<TargetProblem[]> {
  const identity = (targetKey as { artist_id: { entity_id: string } }).artist_id.entity_id;
  const identityId = await identityIdOf(manager, identity.toLowerCase());
  if (identityId === null || (await hasArtist(manager, identityId))) return [];
  return [{ code: 'no_artist_profile', detail: 'Only an identity with an artist profile receives an artist credit', member: 'targetKey/artist_id' }];
}

export interface ArtistCreditOwner {
  entityType: EditorialEntityType;
  targetPath: string;
  /** The members of the key that name the credit's owner, before `artist_id`. */
  ownerKey: Record<string, object>;
  keyRows?: Record<string, KeyRow>;
  value: object;
  descriptions: { add: string; update: string; remove: string };
  find(manager: EntityManager, root: EditorialEntity, key: RowKey): Promise<object | null>;
  write(manager: EntityManager, root: EditorialEntity, key: RowKey, value: unknown, now: Date): Promise<void>;
  remove(manager: EntityManager, root: EditorialEntity, key: RowKey, now: Date): Promise<void>;
  /** Problems with the owner the key names, checked before the artist's. */
  ownerProblems?(manager: EntityManager, root: EditorialEntity, targetKey: object | null): Promise<TargetProblem[]>;
  /** Why the owner the key names can no longer receive the credit. */
  ownerGone?(manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<string[]>;
}

/** Add, update and remove operations on the artist credits of one kind of owner. */
export function artistCreditChanges(owner: ArtistCreditOwner): OperationDefinition[] {
  const { ownerProblems, ownerGone } = owner;
  const read = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const credit = key && (await owner.find(manager, root, key));
    return credit ? { exists: true, value: { ...credit } } : ABSENT;
  };
  const base = {
    entityType: owner.entityType,
    targetPath: owner.targetPath,
    payloadSchemaVersion: 1,
    targetKeySchema: {
      type: 'object',
      additionalProperties: false,
      required: [...Object.keys(owner.ownerKey), 'artist_id'],
      properties: { ...owner.ownerKey, artist_id: ARTIST_ID },
    },
    keyRoots: { artist_id: { entityType: 'identity', idOf: artistIdOfIdentity } },
    ...(owner.keyRows && { keyRows: owner.keyRows }),
    check: () => [],
    references: () => [],
    read,
  } satisfies Partial<OperationDefinition>;
  const write = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
    ...base,
    operation,
    description,
    valueSchema: owner.value,
    targetProblems: async (manager, root, _value, targetKey) => [
      ...(ownerProblems ? await ownerProblems(manager, root, targetKey) : []),
      ...(await artistProblems(manager, targetKey)),
    ],
    constraintProblems: async (manager, root, key) => {
      if (operation === 'update_relation' && !(await read(manager, root, key)).exists) return ['El crédito ya no existe'];
      return ownerGone ? ownerGone(manager, root, key) : [];
    },
    apply: async (manager, root, value, now, key) => {
      await owner.write(manager, root, key!, value, now);
      return { afterValue: await read(manager, root, key), resultKey: key };
    },
  });
  return [
    write('add_relation', owner.descriptions.add),
    write('update_relation', owner.descriptions.update),
    {
      ...base,
      operation: 'remove_relation',
      description: owner.descriptions.remove,
      valueSchema: null,
      apply: async (manager, root, _value, now, key) => {
        await owner.remove(manager, root, key!, now);
        return { afterValue: ABSENT, resultKey: key };
      },
    },
  ];
}
