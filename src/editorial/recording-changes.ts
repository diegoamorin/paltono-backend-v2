import { EntityManager } from 'typeorm';
import {
  RECORDING_FIELDS,
  RecordingFieldPath,
  RecordingGenreValue,
  RecordingValue,
  RecordingWorkValue,
  PartialDateValue,
  createRecording,
  deleteRecordingGenre,
  deleteRecordingWork,
  findCreatedRecording,
  findRecordingGenre,
  findRecordingWork,
  findRecordingWorkByWork,
  insertRecordingWork,
  recordingGenreClashes,
  recordingIdOf,
  recordingWorkClashes,
  updateRecordingWork,
  writeRecordingField,
  writeRecordingGenre,
} from '../music/recordings';
import { RECORDING_WORK_RELATION_TYPES } from '../music/entities/recording.entity';
import { ENTITY_REFERENCE, SOURCE_URL, creditChanges } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { PARTIAL_DATE, daysInMonth } from './identity-creation';
import { INT4, ROW_KEY, reference } from './identity-relation-changes';
import type { OperationDefinition, PayloadProblem, RowKey } from './operation-registry';
import { DESCRIPTION, TITLE, envelope } from './work-changes';

/*
 * Operations on a recording root: its minimal creation, a title, changes to
 * its fields, and the rows it owns: credits, genres keyed by recording and
 * genre, and links to works keyed by their generated id.
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

/** A partial date names a real day of its month. */
function checkDate(date: PartialDateValue | null | undefined, path: string): PayloadProblem[] {
  if (date?.day === undefined || date.month === undefined || date.day <= daysInMonth(date.year, date.month)) return [];
  return [{ path: `${path}/day`, detail: 'recordingDate is not a calendar date' }];
}

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
  check: (value) => checkDate((value as RecordingValue).recordingDate, '/value/recordingDate'),
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
  check: (value) => (path === 'recordings.recording_date' ? checkDate(value as PartialDateValue | null, '/value') : []),
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
  ...GENRE_CHANGES,
  ...RECORDING_WORK_CHANGES,
];
