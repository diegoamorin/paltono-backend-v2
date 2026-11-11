import { EntityManager } from 'typeorm';
import { releaseIdOf } from '../music/releases';
import {
  TrackArtistCreditValue,
  TrackValue,
  deleteTrack,
  deleteTrackArtistCredit,
  findTrack,
  findTrackArtistCredit,
  findTrackAt,
  insertTrack,
  isTrackOf,
  trackClashes,
  trackReferences,
  updateTrack,
  writeTrackArtistCredit,
} from '../music/tracks';
import { ENTITY_REFERENCE } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { INT4, ROW_KEY, envelope, reference } from './identity-relation-changes';
import type { OperationDefinition, PublishedOperation, RowKey, TargetProblem } from './operation-registry';
import { artistCreditChanges, artistCreditValue } from './artist-credit-changes';

/*
 * Relation changes of the tracks of a release, which owns them: the tracks,
 * keyed by their generated id, and the printed credits of each track, keyed
 * by the track and the artist. An insertion names the release in its key, so
 * a release created by the same proposal can receive its tracks; a credit
 * names its track by id or by the insertion of the same proposal that creates
 * it. A track needs its recording and its release published, or published in
 * the same transaction. A track has no platform links: they are its
 * recording's (ADR 0009).
 */

const ABSENT: ValueEnvelope = { exists: false };
const TRACKS = 'tracks';
/** The track a printed credit belongs to: a row of the tracks of the same release. */
const TRACK_ROW = { track_id: { targetPath: TRACKS, resultMember: 'id' } };

const ROW_ID = ROW_KEY.properties.id;

const TRACK_PARENT_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['release_id'],
  properties: { release_id: reference('entity_id', 'Raíz editorial de la edición: la del microcambio') },
};

const TRACK = {
  type: 'object',
  additionalProperties: false,
  required: ['recording', 'discNumber', 'trackNumber'],
  properties: {
    recording: ENTITY_REFERENCE('Raíz editorial de la grabación: publicada, o creada en la misma propuesta'),
    discNumber: { type: 'integer', minimum: 1, maximum: 32767 },
    trackNumber: { type: 'integer', minimum: 1, maximum: 32767 },
    title: {
      type: ['string', 'null'],
      minLength: 1,
      maxLength: 512,
      pattern: '\\S',
      description: 'Título literal de la pista en esta edición; null muestra el título vigente de la grabación sin copiarlo',
    },
  },
};

const releaseOf = async (manager: EntityManager, root: EditorialEntity) => releaseIdOf(manager, root.id);
const releaseOrFail = async (manager: EntityManager, root: EditorialEntity) => (await releaseIdOf(manager, root.id))!;

/** A track names its recording, which must be published or created by the same proposal. */
const proposedTrackRules = {
  rootReferences: (value: unknown) => [
    { entityType: 'recording' as const, entityId: (value as TrackValue).recording.entity_id.toLowerCase(), path: '/value/recording/entity_id' },
  ],
} satisfies Partial<OperationDefinition>;

const readTrack = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
  const releaseId = await releaseOf(manager, root);
  return releaseId === null ? ABSENT : envelope(await findTrack(manager, releaseId, key!.id));
};

const trackBase = { entityType: 'release', targetPath: TRACKS, payloadSchemaVersion: 1, check: () => [], references: () => [] } satisfies Partial<OperationDefinition>;

const TRACK_CHANGES: OperationDefinition[] = [
  {
    ...trackBase,
    ...proposedTrackRules,
    operation: 'add_relation',
    description:
      'Añade una pista a la edición: su grabación, disco y número, mayores que cero, y un título literal opcional. Una posición ' +
      'tiene una sola pista. Su clave es la edición, que puede crearse en la misma propuesta.',
    valueSchema: TRACK,
    targetKeySchema: TRACK_PARENT_KEY,
    naturalKey: (value) => {
      const { discNumber, trackNumber } = (value ?? {}) as Partial<TrackValue>;
      return typeof discNumber === 'number' && typeof trackNumber === 'number' ? { discNumber, trackNumber } : undefined;
    },
    // The track the proposed position would collide with.
    read: async (manager, root, _key, value) => {
      const releaseId = await releaseOf(manager, root);
      return releaseId === null ? ABSENT : envelope(await findTrackAt(manager, releaseId, value as TrackValue));
    },
    constraintProblems: async (manager, root, _key, value) => trackClashes(manager, await releaseOrFail(manager, root), value as TrackValue, null),
    apply: async (manager, root, value, now) => {
      const id = await insertTrack(manager, await releaseOrFail(manager, root), value as TrackValue, now);
      return { afterValue: await readTrack(manager, root, { id }), resultKey: { id } };
    },
  },
  {
    ...trackBase,
    ...proposedTrackRules,
    operation: 'update_relation',
    description: 'Sustituye la grabación, la posición o el título de una pista existente de la edición.',
    valueSchema: TRACK,
    targetKeySchema: ROW_KEY,
    read: readTrack,
    constraintProblems: async (manager, root, key, value) => {
      if (!(await readTrack(manager, root, key)).exists) return ['La pista ya no existe'];
      return trackClashes(manager, await releaseOrFail(manager, root), value as TrackValue, key!.id);
    },
    apply: async (manager, root, value, now, key) => {
      await updateTrack(manager, await releaseOrFail(manager, root), key!.id, value as TrackValue, now);
      return { afterValue: await readTrack(manager, root, key), resultKey: key };
    },
  },
  {
    ...trackBase,
    operation: 'remove_relation',
    description: 'Quita una pista de la edición, una vez quitado su crédito impreso; la revisión guarda sus valores anteriores.',
    valueSchema: null,
    targetKeySchema: ROW_KEY,
    read: readTrack,
    constraintProblems: async (manager, root, key) => trackReferences(manager, await releaseOrFail(manager, root), key!.id),
    apply: async (manager, root, _value, now, key) => {
      await deleteTrack(manager, await releaseOrFail(manager, root), key!.id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

/** A track a key names by its id belongs to the release; one an insertion creates does by construction. */
async function trackProblems(manager: EntityManager, root: EditorialEntity, targetKey: object | null): Promise<TargetProblem[]> {
  const trackId = (targetKey as { track_id: unknown }).track_id;
  const releaseId = await releaseOf(manager, root);
  if (typeof trackId !== 'number' || releaseId === null || (await isTrackOf(manager, releaseId, trackId))) return [];
  return [{ code: 'relation_row_not_found', detail: 'The release has no track with this id', member: 'targetKey/track_id' }];
}

/** The track a resolved key names is still a track of the release. */
async function trackGone(manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<string[]> {
  return (await isTrackOf(manager, await releaseOrFail(manager, root), key!.track_id)) ? [] : ['La pista ya no existe'];
}

// Printed credits of a track (ADR 0008): the payload keeps its v1, only its meaning changed

const TRACK_CREDIT_CHANGES = artistCreditChanges({
  entityType: 'release',
  targetPath: 'track_artist_credits',
  ownerKey: { track_id: { ...ROW_ID, description: 'Pista de la edición, o inserción de este envío que la creará' } },
  keyRows: TRACK_ROW,
  value: artistCreditValue('pista'),
  descriptions: {
    add:
      'Añade un artista principal (`main`), invitado (`featured`) o remezclador (`remixer`) al crédito impreso de una pista, solo ' +
      'cuando la edición acredita la grabación de otra forma. Una pista con crédito impreso lo muestra entero en lugar del crédito ' +
      'de artista de su grabación. Su clave es la pista y la identidad del artista. No atribuye autoría, interpretación ni producción.',
    update: 'Cambia la clase, la posición o el nombre acreditado de un artista del crédito impreso de la pista.',
    remove:
      'Quita un artista del crédito impreso de la pista; sin ninguno, la pista muestra el crédito de su grabación. La revisión ' +
      'guarda sus valores anteriores.',
  },
  find: async (manager, root, key) => {
    const releaseId = await releaseOf(manager, root);
    return releaseId === null ? null : findTrackArtistCredit(manager, releaseId, key.track_id, key.artist_id);
  },
  write: async (manager, root, key, value, now) =>
    writeTrackArtistCredit(manager, await releaseOrFail(manager, root), key.track_id, key.artist_id, value as TrackArtistCreditValue, now),
  remove: async (manager, root, key, now) =>
    deleteTrackArtistCredit(manager, await releaseOrFail(manager, root), key.track_id, key.artist_id, now),
  ownerProblems: trackProblems,
  ownerGone: trackGone,
});

export const RELEASE_TRACK_CHANGES: OperationDefinition[] = [...TRACK_CHANGES, ...TRACK_CREDIT_CHANGES];

// Platform links of a track, retired without a successor (ADR 0009): kept to read the history, never applied.

const TRACK_PLATFORM_LINK = {
  type: 'object',
  additionalProperties: false,
  required: ['platformId', 'url'],
  properties: {
    platformId: { type: 'integer', minimum: 1, maximum: INT4, description: 'id en /v1/platforms de una plataforma que admite pistas' },
    url: { type: 'string', maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' },
  },
};

const TRACK_PLATFORM_LINK_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['track_id'],
  properties: { track_id: { ...ROW_ID, description: 'Pista de la edición, o inserción de este envío que la creará' } },
};

const retiredTrackPlatformLink = { entityType: 'release', targetPath: 'track_platform_links', payloadSchemaVersion: 1 } satisfies Partial<PublishedOperation>;

export const RETIRED_TRACK_PLATFORM_LINK_CHANGES: PublishedOperation[] = [
  {
    ...retiredTrackPlatformLink,
    operation: 'add_relation',
    description: 'Retirada: el enlace de plataforma es de la grabación (ADR 0009). Añadía un enlace de una pista en una plataforma.',
    valueSchema: TRACK_PLATFORM_LINK,
    targetKeySchema: TRACK_PLATFORM_LINK_KEY,
  },
  {
    ...retiredTrackPlatformLink,
    operation: 'update_relation',
    description: 'Retirada: el enlace de plataforma es de la grabación (ADR 0009). Sustituía la plataforma y la URL de un enlace de una pista.',
    valueSchema: TRACK_PLATFORM_LINK,
    targetKeySchema: ROW_KEY,
  },
  {
    ...retiredTrackPlatformLink,
    operation: 'remove_relation',
    description: 'Retirada: el enlace de plataforma es de la grabación (ADR 0009). Quitaba un enlace de una pista.',
    valueSchema: null,
    targetKeySchema: ROW_KEY,
  },
];

