import { EntityManager } from 'typeorm';
import { TRACK_ARTIST_RANKS } from '../music/entities/track.entity';
import { artistIdOfIdentity, releaseIdOf } from '../music/releases';
import {
  TrackArtistCreditValue,
  TrackPlatformLinkValue,
  TrackValue,
  deleteTrack,
  deleteTrackArtistCredit,
  deleteTrackLink,
  findTrack,
  findTrackArtistCredit,
  findTrackAt,
  findTrackLink,
  findTrackLinkByUrl,
  insertTrack,
  insertTrackLink,
  isTrackOf,
  trackClashes,
  trackLinkClashes,
  trackOfLink,
  trackReferences,
  updateTrack,
  updateTrackLink,
  writeTrackArtistCredit,
} from '../music/tracks';
import { Platform } from '../vocabularies/entities/platform.entity';
import { ENTITY_REFERENCE } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { INT4, ROW_KEY, envelope, reference } from './identity-relation-changes';
import type { OperationDefinition, RowKey, TargetProblem } from './operation-registry';
import { artistProblems } from './release-credit-changes';

/*
 * Relation changes of the tracks of a release, which owns them: the tracks,
 * keyed by their generated id, the presentation credits of each track, keyed
 * by the track and the artist, and its platform links. An insertion names the
 * release in its key, so a release created by the same proposal can receive
 * its tracks; a credit or a link names its track by id or by the insertion of
 * the same proposal that creates it. A track needs its recording and its
 * release published, or published in the same transaction.
 */

const ABSENT: ValueEnvelope = { exists: false };
const TRACKS = 'tracks';
/** The track a credit or a link belongs to: a row of the tracks of the same release. */
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
    description: 'Quita una pista de la edición, una vez quitados sus créditos y enlaces; la revisión guarda sus valores anteriores.',
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

// Presentation credits of a track

const TRACK_CREDIT_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['track_id', 'artist_id'],
  properties: {
    track_id: { ...ROW_ID, description: 'Pista de la edición, o inserción de este envío que la creará' },
    artist_id: reference('entity_id', 'Raíz editorial de la identidad del artista: publicada, o creada en la misma propuesta, con perfil artístico'),
  },
};

const TRACK_CREDIT = {
  type: 'object',
  additionalProperties: false,
  required: ['rank', 'position'],
  properties: {
    rank: { enum: TRACK_ARTIST_RANKS, description: '`main`, `featured` o `remixer`; una por artista y pista' },
    position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden de presentación' },
    creditedAs: { type: ['string', 'null'], maxLength: 200, pattern: '\\S', description: 'Nombre literal de la fuente; null muestra el nombre visible' },
  },
};

const readCredit = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
  const releaseId = await releaseOf(manager, root);
  const credit = key && releaseId !== null && (await findTrackArtistCredit(manager, releaseId, key.track_id, key.artist_id));
  return credit ? { exists: true, value: { ...credit } } : ABSENT;
};

const creditBase = {
  entityType: 'release',
  targetPath: 'track_artist_credits',
  payloadSchemaVersion: 1,
  targetKeySchema: TRACK_CREDIT_KEY,
  keyRoots: { artist_id: { entityType: 'identity', idOf: artistIdOfIdentity } },
  keyRows: TRACK_ROW,
  check: () => [],
  references: () => [],
  read: readCredit,
} satisfies Partial<OperationDefinition>;

const creditWrite = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
  ...creditBase,
  operation,
  description,
  valueSchema: TRACK_CREDIT,
  targetProblems: async (manager, root, _value, targetKey) => [
    ...(await trackProblems(manager, root, targetKey)),
    ...(await artistProblems(manager, targetKey)),
  ],
  constraintProblems: async (manager, root, key) => {
    if (operation === 'update_relation' && !(await readCredit(manager, root, key)).exists) return ['El crédito ya no existe'];
    return trackGone(manager, root, key);
  },
  apply: async (manager, root, value, now, key) => {
    await writeTrackArtistCredit(manager, await releaseOrFail(manager, root), key!.track_id, key!.artist_id, value as TrackArtistCreditValue, now);
    return { afterValue: await readCredit(manager, root, key), resultKey: key };
  },
});

const TRACK_CREDIT_CHANGES: OperationDefinition[] = [
  creditWrite(
    'add_relation',
    'Presenta una pista con un artista principal (`main`), invitado (`featured`) o remezclador (`remixer`). Su clave es la pista y ' +
      'la identidad del artista. No atribuye autoría, interpretación ni producción.',
  ),
  creditWrite('update_relation', 'Cambia la clase, la posición o el nombre acreditado de un artista de la pista.'),
  {
    ...creditBase,
    operation: 'remove_relation',
    description: 'Quita un artista de la presentación de la pista; la revisión guarda sus valores anteriores.',
    valueSchema: null,
    apply: async (manager, root, _value, now, key) => {
      await deleteTrackArtistCredit(manager, await releaseOrFail(manager, root), key!.track_id, key!.artist_id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

// Platform links of a track

// No play count: it is deferred beyond the MVP, so no write sets it.
const TRACK_LINK = {
  type: 'object',
  additionalProperties: false,
  required: ['platformId', 'url'],
  properties: {
    platformId: { type: 'integer', minimum: 1, maximum: INT4, description: 'id en /v1/platforms de una plataforma que admite pistas' },
    url: { type: 'string', maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' },
  },
};

const TRACK_LINK_PARENT_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['track_id'],
  properties: { track_id: { ...ROW_ID, description: 'Pista de la edición, o inserción de este envío que la creará' } },
};

const readLink = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
  const releaseId = await releaseOf(manager, root);
  return releaseId === null ? ABSENT : envelope(await findTrackLink(manager, releaseId, key!.id));
};

const linkBase = { entityType: 'release', targetPath: 'track_platform_links', payloadSchemaVersion: 1, check: () => [] } satisfies Partial<OperationDefinition>;

/** What a proposed link needs besides its schema: a platform that exists and supports tracks. */
const proposedLinkRules = {
  references: (value: unknown) => [{ vocabulary: 'platforms' as const, id: (value as TrackPlatformLinkValue).platformId, path: '/value/platformId' }],
  // Run on the current vocabulary each time, as an administrator may change what a platform supports.
  linkProblems: async (manager: EntityManager, value: unknown): Promise<TargetProblem[]> => {
    const platform = await manager.findOneBy(Platform, { id: (value as TrackPlatformLinkValue).platformId });
    if (!platform || platform.supportsTrack) return [];
    return [{ code: 'unsupported_platform', detail: `${platform.name} does not support track links`, member: 'proposedValue/value/platformId' }];
  },
};

const TRACK_LINK_CHANGES: OperationDefinition[] = [
  {
    ...linkBase,
    references: proposedLinkRules.references,
    operation: 'add_relation',
    description:
      'Añade un enlace HTTP(S) de una pista en una plataforma que admite pistas. Plataforma y URL son únicas en la pista. Su clave ' +
      'es la pista, por id o por la inserción de este envío que la creará.',
    valueSchema: TRACK_LINK,
    targetKeySchema: TRACK_LINK_PARENT_KEY,
    keyRows: TRACK_ROW,
    naturalKey: (value) => {
      const { platformId, url } = (value ?? {}) as Partial<TrackPlatformLinkValue>;
      return typeof platformId === 'number' && typeof url === 'string' ? { platformId, url } : undefined;
    },
    targetProblems: async (manager, root, value, targetKey) => [
      ...(await trackProblems(manager, root, targetKey)),
      ...(await proposedLinkRules.linkProblems(manager, value)),
    ],
    // The link the proposed platform and URL would collide with.
    read: async (manager, root, key, value) => {
      const releaseId = await releaseOf(manager, root);
      if (!key || releaseId === null || !(await isTrackOf(manager, releaseId, key.track_id))) return ABSENT;
      return envelope(await findTrackLinkByUrl(manager, key.track_id, value as TrackPlatformLinkValue));
    },
    constraintProblems: async (manager, root, key, value) => {
      const gone = await trackGone(manager, root, key);
      return gone.length > 0 ? gone : trackLinkClashes(manager, key!.track_id, value as TrackPlatformLinkValue, null);
    },
    apply: async (manager, root, value, now, key) => {
      const id = await insertTrackLink(manager, await releaseOrFail(manager, root), key!.track_id, value as TrackPlatformLinkValue, now);
      return { afterValue: await readLink(manager, root, { id }), resultKey: { id } };
    },
  },
  {
    ...linkBase,
    references: proposedLinkRules.references,
    operation: 'update_relation',
    description: 'Sustituye la plataforma y la URL de un enlace existente de una pista de la edición.',
    valueSchema: TRACK_LINK,
    targetKeySchema: ROW_KEY,
    targetProblems: (manager, _root, value) => proposedLinkRules.linkProblems(manager, value),
    read: readLink,
    constraintProblems: async (manager, root, key, value) => {
      const trackId = await trackOfLink(manager, await releaseOrFail(manager, root), key!.id);
      if (trackId === null) return ['El enlace ya no existe'];
      return trackLinkClashes(manager, trackId, value as TrackPlatformLinkValue, key!.id);
    },
    apply: async (manager, root, value, now, key) => {
      await updateTrackLink(manager, await releaseOrFail(manager, root), key!.id, value as TrackPlatformLinkValue, now);
      return { afterValue: await readLink(manager, root, key), resultKey: key };
    },
  },
  {
    ...linkBase,
    references: () => [],
    operation: 'remove_relation',
    description: 'Quita un enlace de una pista de la edición; la revisión guarda sus valores anteriores.',
    valueSchema: null,
    targetKeySchema: ROW_KEY,
    read: readLink,
    apply: async (manager, root, _value, now, key) => {
      await deleteTrackLink(manager, await releaseOrFail(manager, root), key!.id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

export const RELEASE_TRACK_CHANGES: OperationDefinition[] = [...TRACK_CHANGES, ...TRACK_CREDIT_CHANGES, ...TRACK_LINK_CHANGES];
