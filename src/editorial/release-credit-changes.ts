import { EntityManager } from 'typeorm';
import { hasArtist } from '../catalog-identities/artist-relations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import {
  ReleaseArtistCreditValue,
  artistIdOfIdentity,
  deleteReleaseArtistCredit,
  findReleaseArtistCredit,
  writeReleaseArtistCredit,
} from '../music/releases';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { reference } from './identity-relation-changes';
import type { OperationDefinition, RowKey, TargetProblem } from './operation-registry';

/*
 * Presentation credits of a release group: the artists it is presented with,
 * in order, for all its releases. A credit is keyed by the group and the
 * artist, whose profile has no root of its own: the key names the artist's
 * identity by its editorial UUID, checked like any other root a change names.
 * They do not credit authorship, performance or production.
 */

const ABSENT: ValueEnvelope = { exists: false };
const TARGET_PATH = 'release_artist_credits';

const CREDIT_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['release_group_id', 'artist_id'],
  properties: {
    release_group_id: reference('entity_id', 'Raíz editorial del lanzamiento: la del microcambio'),
    artist_id: reference('entity_id', 'Raíz editorial de la identidad del artista: publicada, o creada en la misma propuesta, con perfil artístico'),
  },
};

const CREDIT = {
  type: 'object',
  additionalProperties: false,
  required: ['position'],
  properties: {
    position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden de presentación' },
    creditedAs: { type: ['string', 'null'], maxLength: 200, pattern: '\\S', description: 'Nombre literal de la fuente; null muestra el nombre visible' },
  },
};

const read = async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
  const credit = key && (await findReleaseArtistCredit(manager, key.release_group_id, key.artist_id));
  return credit ? { exists: true, value: { ...credit } } : ABSENT;
};

/** The identity a credit's key names has an artist profile, once it is created: a reservation's is checked after its creation applies. */
async function artistProblems(manager: EntityManager, targetKey: object | null): Promise<TargetProblem[]> {
  const identity = (targetKey as { artist_id: { entity_id: string } }).artist_id.entity_id;
  const identityId = await identityIdOf(manager, identity.toLowerCase());
  if (identityId === null || (await hasArtist(manager, identityId))) return [];
  return [{ code: 'no_artist_profile', detail: 'Only an identity with an artist profile presents a release group', member: 'targetKey/artist_id' }];
}

const base = {
  entityType: 'release_group',
  targetPath: TARGET_PATH,
  payloadSchemaVersion: 1,
  targetKeySchema: CREDIT_KEY,
  keyRoots: { artist_id: { entityType: 'identity', idOf: artistIdOfIdentity } },
  check: () => [],
  references: () => [],
  read,
} satisfies Partial<OperationDefinition>;

const write = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
  ...base,
  operation,
  description,
  valueSchema: CREDIT,
  targetProblems: (manager, _root, _value, targetKey) => artistProblems(manager, targetKey),
  constraintProblems: async (manager, root, key) =>
    operation === 'update_relation' && !(await read(manager, root, key)).exists ? ['El crédito ya no existe'] : [],
  apply: async (manager, root, value, now, key) => {
    await writeReleaseArtistCredit(manager, key!.release_group_id, key!.artist_id, value as ReleaseArtistCreditValue, now);
    return { afterValue: await read(manager, root, key), resultKey: key };
  },
});

export const RELEASE_CREDIT_CHANGES: OperationDefinition[] = [
  write('add_relation', 'Presenta el lanzamiento con un artista, en una posición. Su clave es el lanzamiento y la identidad del artista.'),
  write('update_relation', 'Cambia la posición o el nombre acreditado de un artista del lanzamiento.'),
  {
    ...base,
    operation: 'remove_relation',
    description: 'Quita un artista de la presentación del lanzamiento; la revisión guarda sus valores anteriores.',
    valueSchema: null,
    apply: async (manager, _root, _value, now, key) => {
      await deleteReleaseArtistCredit(manager, key!.release_group_id, key!.artist_id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];
