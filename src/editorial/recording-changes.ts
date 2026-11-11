import { EntityManager } from 'typeorm';
import { PartialDateValue } from '../common/partial-date/partial-date';
import {
  RECORDING_FIELDS,
  RecordingArtistCreditValue,
  RecordingFieldPath,
  RecordingGenreValue,
  RecordingPlatformLinkValue,
  RecordingValue,
  RecordingWorkValue,
  createRecording,
  deleteRecordingArtistCredit,
  deleteRecordingGenre,
  deleteRecordingPlatformLink,
  deleteRecordingWork,
  findCreatedRecording,
  findRecordingArtistCredit,
  findRecordingGenre,
  findRecordingPlatformLink,
  findRecordingWork,
  findRecordingWorkByWork,
  insertRecordingWork,
  recordingGenreClashes,
  recordingIdOf,
  recordingWorkClashes,
  updateRecordingWork,
  writeRecordingArtistCredit,
  writeRecordingField,
  writeRecordingGenre,
  writeRecordingPlatformLink,
} from '../music/recordings';
import { RECORDING_WORK_RELATION_TYPES } from '../music/entities/recording.entity';
import { Platform } from '../vocabularies/entities/platform.entity';
import { artistCreditChanges, artistCreditValue } from './artist-credit-changes';
import { ENTITY_REFERENCE, SOURCE_URL, creditChanges } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { PARTIAL_DATE, partialDateProblems } from './identity-creation';
import { INT4, ROW_KEY, reference } from './identity-relation-changes';
import type { OperationDefinition, RowKey, TargetProblem } from './operation-registry';
import { DESCRIPTION, TITLE, envelope } from './work-changes';

/*
 * Operations on a recording root: its minimal creation, a title, changes to
 * its fields, and the rows it owns: credits, its artist credit keyed by
 * recording and artist, genres keyed by recording and genre, links to works
 * keyed by their generated id, and platform links keyed by recording and
 * platform.
 */

const ABSENT: ValueEnvelope = { exists: false };
const IS_EXPLICIT = { type: 'boolean', description: 'Contenido explícito; una versión limpia es otra grabación' };
const ISRC = { type: ['string', 'null'], pattern: '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$', description: 'ISRC canónico, sin guiones' };

const RECORDING = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { title: TITLE, description: DESCRIPTION, isExplicit: IS_EXPLICIT, isrc: ISRC, recordingDate: PARTIAL_DATE },
};

const noReferences = { references: () => [] } satisfies Pick<OperationDefinition, 'references'>;

const RECORDING_CREATION: OperationDefinition = {
  entityType: 'recording',
  operation: 'create_entity',
  targetPath: 'recordings',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una grabación: su título. El contenido explícito es `false` si no se indica; la fecha de grabación es parcial.',
  valueSchema: RECORDING,
  targetKeySchema: null,
  check: (value) => partialDateProblems('recordingDate', (value as RecordingValue).recordingDate, '/value/recordingDate'),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedRecording(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  apply: async (manager, root, value, now) => {
    const recording = await createRecording(manager, root.id, value as RecordingValue, now);
    const { value: created } = (await findCreatedRecording(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: recording.id, publicId: recording.publicId } };
  },
};

const FIELD_RULES: Record<RecordingFieldPath, { description: string; schema: object }> = {
  'recordings.title': { description: 'Título de la grabación.', schema: TITLE },
  'recordings.description': { description: 'Descripción de la grabación, o null.', schema: DESCRIPTION },
  'recordings.is_explicit': { description: 'Si la grabación tiene contenido explícito.', schema: IS_EXPLICIT },
  'recordings.isrc': { description: 'ISRC canónico de la grabación, o null.', schema: ISRC },
  'recordings.recording_date': { description: 'Fecha parcial de grabación: año, mes y día cambian juntos.', schema: PARTIAL_DATE },
};

const RECORDING_FIELD_CHANGES: OperationDefinition[] = (Object.keys(RECORDING_FIELDS) as RecordingFieldPath[]).map((path) => ({
  entityType: 'recording',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: FIELD_RULES[path].description,
  valueSchema: FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'recordings.recording_date' ? partialDateProblems('recordingDate', value as PartialDateValue | null) : []),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedRecording(manager, root.id);
    return created ? envelope(created.value[RECORDING_FIELDS[path]]) : ABSENT;
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeRecordingField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

const GENRE_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['recording_id', 'genre_id'],
  properties: {
    recording_id: reference('entity_id', 'Raíz editorial de la grabación: la del microcambio'),
    genre_id: { type: 'integer', minimum: 1, maximum: INT4, description: 'id del género en /v1/genres' },
  },
};

const GENRE = { type: 'object', additionalProperties: false, required: ['isPrimary'], properties: { isPrimary: { type: 'boolean' } } };

const genreBase = {
  entityType: 'recording',
  targetPath: 'recording_genres',
  payloadSchemaVersion: 1,
  targetKeySchema: GENRE_KEY,
  check: () => [],
  references: () => [],
  keyReferences: (targetKey: object) => [{ vocabulary: 'genres', id: (targetKey as RowKey).genre_id, path: '/genre_id' }],
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const row = key && (await findRecordingGenre(manager, key.recording_id, key.genre_id));
    return row ? { exists: true, value: { ...row } } : ABSENT;
  },
} satisfies Partial<OperationDefinition>;

const genreWrite = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
  ...genreBase,
  operation,
  description,
  valueSchema: GENRE,
  constraintProblems: async (manager, _root, key, value) => {
    if (operation === 'update_relation' && !(await findRecordingGenre(manager, key!.recording_id, key!.genre_id))) return ['El género ya no está asignado'];
    return recordingGenreClashes(manager, key!.recording_id, key!.genre_id, value as RecordingGenreValue);
  },
  apply: async (manager, root, value, now, key) => {
    await writeRecordingGenre(manager, key!.recording_id, key!.genre_id, value as RecordingGenreValue, now);
    return { afterValue: await genreBase.read(manager, root, key), resultKey: key };
  },
});

const GENRE_CHANGES: OperationDefinition[] = [
  genreWrite('add_relation', 'Asigna un género a la grabación. Su clave es la grabación y el género; como mucho uno es primario.'),
  genreWrite('update_relation', 'Cambia si un género asignado es el primario de la grabación.'),
  {
    ...genreBase,
    operation: 'remove_relation',
    description: 'Quita un género de la grabación.',
    valueSchema: null,
    apply: async (manager, _root, _value, now, key) => {
      await deleteRecordingGenre(manager, key!.recording_id, key!.genre_id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

// Platform links (ADR 0009): at most one per platform, so the platform is part of the key and a replacement changes only the URL.

const PLATFORM_LINK_KEY = {
  type: 'object',
  additionalProperties: false,
  required: ['recording_id', 'platform_id'],
  properties: {
    recording_id: reference('entity_id', 'Raíz editorial de la grabación: la del microcambio'),
    platform_id: { type: 'integer', minimum: 1, maximum: INT4, description: 'id en /v1/platforms de una plataforma que admite grabaciones' },
  },
};

const PLATFORM_LINK = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: { url: { type: 'string', maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' } },
};

const platformLinkBase = {
  entityType: 'recording',
  targetPath: 'recording_platform_links',
  payloadSchemaVersion: 1,
  targetKeySchema: PLATFORM_LINK_KEY,
  check: () => [],
  references: () => [],
  keyReferences: (targetKey: object) => [{ vocabulary: 'platforms', id: (targetKey as RowKey).platform_id, path: '/platform_id' }],
  read: async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const row = key && (await findRecordingPlatformLink(manager, key.recording_id, key.platform_id));
    return row ? { exists: true, value: { ...row } } : ABSENT;
  },
} satisfies Partial<OperationDefinition>;

/** A link needs a platform that supports recordings, checked on the current vocabulary, as an administrator may change it. */
async function unsupportedPlatform(manager: EntityManager, targetKey: object | null): Promise<TargetProblem[]> {
  const platform = await manager.findOneBy(Platform, { id: (targetKey as RowKey).platform_id });
  if (!platform || platform.supportsRecording) return [];
  return [{ code: 'unsupported_platform', detail: `${platform.name} does not support recording links`, member: 'targetKey/platform_id' }];
}

const platformLinkWrite = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
  ...platformLinkBase,
  operation,
  description,
  valueSchema: PLATFORM_LINK,
  targetProblems: (manager, _root, _value, targetKey) => unsupportedPlatform(manager, targetKey),
  constraintProblems: async (manager, _root, key) => {
    if (operation === 'update_relation' && !(await findRecordingPlatformLink(manager, key!.recording_id, key!.platform_id))) return ['El enlace ya no existe'];
    return [];
  },
  apply: async (manager, root, value, now, key) => {
    await writeRecordingPlatformLink(manager, key!.recording_id, key!.platform_id, value as RecordingPlatformLinkValue, now);
    return { afterValue: await platformLinkBase.read(manager, root, key), resultKey: key };
  },
});

const PLATFORM_LINK_CHANGES: OperationDefinition[] = [
  platformLinkWrite(
    'add_relation',
    'Enlaza la grabación en una plataforma que admite grabaciones: donde se puede escuchar, con una URL HTTP(S). Su clave es la ' +
      'grabación, que puede crearse en la misma propuesta, y la plataforma; la grabación tiene a lo sumo un enlace por plataforma.',
  ),
  platformLinkWrite('update_relation', 'Reemplaza la URL del enlace de la grabación en una plataforma; cambiar de plataforma es quitarlo y añadir otro.'),
  {
    ...platformLinkBase,
    operation: 'remove_relation',
    description: 'Quita el enlace de la grabación en una plataforma; la revisión guarda su URL anterior.',
    valueSchema: null,
    apply: async (manager, _root, _value, now, key) => {
      await deleteRecordingPlatformLink(manager, key!.recording_id, key!.platform_id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

// Artist credit (ADR 0008)

const ARTIST_CREDIT_CHANGES = artistCreditChanges({
  entityType: 'recording',
  targetPath: 'recording_artist_credits',
  ownerKey: { recording_id: reference('entity_id', 'Raíz editorial de la grabación: la del microcambio') },
  value: artistCreditValue('grabación'),
  descriptions: {
    add:
      'Acredita a un artista principal (`main`), invitado (`featured`) o remezclador (`remixer`) en la grabación. Su clave es la ' +
      'grabación, que puede crearse en la misma propuesta, y la identidad del artista. Las pistas sin crédito impreso lo muestran. ' +
      'No atribuye autoría, interpretación ni producción.',
    update: 'Cambia la clase, la posición o el nombre acreditado de un artista de la grabación.',
    remove: 'Quita un artista del crédito de la grabación; la revisión guarda sus valores anteriores.',
  },
  find: (manager, _root, key) => findRecordingArtistCredit(manager, key.recording_id, key.artist_id),
  write: (manager, _root, key, value, now) =>
    writeRecordingArtistCredit(manager, key.recording_id, key.artist_id, value as RecordingArtistCreditValue, now),
  remove: (manager, _root, key, now) => deleteRecordingArtistCredit(manager, key.recording_id, key.artist_id, now),
});

const OPTIONAL_TEXT = { type: ['string', 'null'], maxLength: 10000 };

const RECORDING_WORK = {
  type: 'object',
  additionalProperties: false,
  required: ['work', 'relationType'],
  properties: {
    work: ENTITY_REFERENCE('Raíz editorial de la obra: publicada, o creada en la misma propuesta'),
    relationType: { enum: RECORDING_WORK_RELATION_TYPES, description: '`performance` interpreta la obra, `interpolation` recrea material y `sample` incorpora material grabado' },
    position: { type: ['integer', 'null'], minimum: 1, maximum: 32767, description: 'Orden de la obra en un medley, o null' },
    details: OPTIONAL_TEXT,
    sourceText: OPTIONAL_TEXT,
    sourceUrl: SOURCE_URL,
  },
};

const recordingIdOrFail = async (manager: EntityManager, root: EditorialEntity) => (await recordingIdOf(manager, root.id))!;

const readRecordingWork = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
  const recordingId = await recordingIdOf(manager, root.id);
  const row = recordingId === null ? null : await findRecordingWork(manager, recordingId, key!.id);
  return row ? { exists: true, value: { ...row } as never } : ABSENT;
};

const recordingWorkBase = { entityType: 'recording', targetPath: 'recording_works', payloadSchemaVersion: 1, check: () => [], references: () => [] } satisfies Partial<OperationDefinition>;

const proposedWorkRules = {
  rootReferences: (value: unknown) => [
    { entityType: 'work' as const, entityId: (value as RecordingWorkValue).work.entity_id.toLowerCase(), path: '/value/work/entity_id' },
  ],
} satisfies Partial<OperationDefinition>;

const RECORDING_WORK_CHANGES: OperationDefinition[] = [
  {
    ...recordingWorkBase,
    ...proposedWorkRules,
    operation: 'add_relation',
    description: 'Relaciona la grabación con una obra que interpreta, interpola o samplea; una relación por obra y tipo.',
    valueSchema: RECORDING_WORK,
    targetKeySchema: null,
    naturalKey: (value) => {
      const { work, relationType } = (value ?? {}) as Partial<RecordingWorkValue>;
      return typeof work?.entity_id === 'string' && typeof relationType === 'string' ? { work: { entity_id: work.entity_id }, relationType } : undefined;
    },
    read: async (manager, root, _key, value) => {
      const recordingId = await recordingIdOf(manager, root.id);
      const row = recordingId === null ? null : await findRecordingWorkByWork(manager, recordingId, value as RecordingWorkValue);
      return row ? { exists: true, value: { ...row } as never } : ABSENT;
    },
    constraintProblems: async (manager, root, _key, value) => recordingWorkClashes(manager, await recordingIdOrFail(manager, root), value as RecordingWorkValue, null),
    apply: async (manager, root, value, now) => {
      const id = await insertRecordingWork(manager, await recordingIdOrFail(manager, root), value as RecordingWorkValue, now);
      return { afterValue: await readRecordingWork(manager, root, { id }), resultKey: { id } };
    },
  },
  {
    ...recordingWorkBase,
    ...proposedWorkRules,
    operation: 'update_relation',
    description: 'Sustituye los datos de una relación existente de la grabación con una obra.',
    valueSchema: RECORDING_WORK,
    targetKeySchema: ROW_KEY,
    read: readRecordingWork,
    constraintProblems: async (manager, root, key, value) => {
      if (!(await readRecordingWork(manager, root, key)).exists) return ['La relación ya no existe'];
      return recordingWorkClashes(manager, await recordingIdOrFail(manager, root), value as RecordingWorkValue, key!.id);
    },
    apply: async (manager, root, value, now, key) => {
      await updateRecordingWork(manager, await recordingIdOrFail(manager, root), key!.id, value as RecordingWorkValue, now);
      return { afterValue: await readRecordingWork(manager, root, key), resultKey: key };
    },
  },
  {
    ...recordingWorkBase,
    operation: 'remove_relation',
    description: 'Quita una relación de la grabación con una obra; la revisión guarda sus valores anteriores.',
    valueSchema: null,
    targetKeySchema: ROW_KEY,
    read: readRecordingWork,
    apply: async (manager, root, _value, now, key) => {
      await deleteRecordingWork(manager, await recordingIdOrFail(manager, root), key!.id, now);
      return { afterValue: ABSENT, resultKey: key };
    },
  },
];

export const RECORDING_CHANGES: OperationDefinition[] = [
  RECORDING_CREATION,
  ...RECORDING_FIELD_CHANGES,
  ...creditChanges({ entityType: 'recording', targetPath: 'recording_contributions', scope: 'recording', ownerIdOf: recordingIdOf, noun: 'la grabación' }),
  ...ARTIST_CREDIT_CHANGES,
  ...GENRE_CHANGES,
  ...RECORDING_WORK_CHANGES,
  ...PLATFORM_LINK_CHANGES,
];
