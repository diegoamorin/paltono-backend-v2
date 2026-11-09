import { randomUUID } from 'node:crypto';
import { EntityManager, In, Not } from 'typeorm';
import { newPublicId } from '../catalog-identities/identity-creations';
import { PartialDateValue, partialDateColumns, partialDateValue } from '../common/partial-date/partial-date';
import { Work } from './entities/work.entity';
import { Recording, RecordingArtistCredit, RecordingGenre, RecordingWork, RecordingWorkRelationType, ArtistCreditRank } from './entities/recording.entity';

/*
 * The writes of a recording and of the rows it owns besides its credits
 * (`credits.ts`): its artist credit, its genres and the works it relates to. The editorial flow
 * calls them inside the transaction that applies a microchange. Every read is
 * scoped to one recording, so a key never reaches the row of another one.
 */

/** A recording as its creation proposes it and its revisions record it. */
export interface RecordingValue {
  title: string;
  description?: string | null;
  isExplicit?: boolean;
  isrc?: string | null;
  recordingDate?: PartialDateValue | null;
}

export const RECORDING_FIELDS = {
  'recordings.title': 'title',
  'recordings.description': 'description',
  'recordings.is_explicit': 'isExplicit',
  'recordings.isrc': 'isrc',
  'recordings.recording_date': 'recordingDate',
} as const;
export type RecordingFieldPath = keyof typeof RECORDING_FIELDS;

/** A genre of a recording, keyed by recording and genre. */
export interface RecordingGenreValue {
  isPrimary: boolean;
}

/** A work a recording relates to, named by its editorial root. */
export interface RecordingWorkValue {
  work: { entity_id: string };
  relationType: RecordingWorkRelationType;
  position?: number | null;
  details?: string | null;
  sourceText?: string | null;
  sourceUrl?: string | null;
}

/** The internal id of the recording of an editorial root, or null while it is only reserved. */
export async function recordingIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const recording = await manager.findOne(Recording, { select: { id: true }, where: { editorialEntityId } });
  return recording?.id ?? null;
}

/** The editorial root of the recording with the given public id, or null if there is none. */
export async function recordingRootOfPublicId(manager: EntityManager, publicId: string): Promise<string | null> {
  const recording = await manager.findOne(Recording, { select: { editorialEntityId: true }, where: { publicId } });
  return recording?.editorialEntityId ?? null;
}

/** The public id of the recording of each given editorial root, by root. */
export async function recordingPublicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>> {
  const recordings = await manager.find(Recording, { select: { editorialEntityId: true, publicId: true }, where: { editorialEntityId: In(editorialEntityIds) } });
  return new Map(recordings.map(({ editorialEntityId, publicId }) => [editorialEntityId, publicId]));
}

export async function findCreatedRecording(manager: EntityManager, editorialEntityId: string): Promise<{ recording: Recording; value: RecordingValue } | null> {
  const recording = await manager.findOneBy(Recording, { editorialEntityId });
  if (!recording) return null;
  return {
    recording,
    value: {
      title: recording.title,
      description: recording.description,
      isExplicit: recording.isExplicit,
      isrc: recording.isrc,
      recordingDate: partialDateValue(recording, 'recording'),
    },
  };
}

export async function createRecording(manager: EntityManager, editorialEntityId: string, value: RecordingValue, now: Date): Promise<Recording> {
  await manager.insert(Recording, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    title: value.title,
    description: value.description ?? null,
    isExplicit: value.isExplicit ?? false,
    isrc: value.isrc ?? null,
    ...partialDateColumns('recording', value.recordingDate),
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedRecording(manager, editorialEntityId))!.recording;
}

export async function writeRecordingField(
  manager: EntityManager,
  editorialEntityId: string,
  path: RecordingFieldPath,
  value: unknown,
  now: Date,
): Promise<unknown> {
  const field = RECORDING_FIELDS[path];
  const columns = field === 'recordingDate' ? partialDateColumns('recording', value as PartialDateValue | null) : { [field]: value };
  await manager.update(Recording, { editorialEntityId }, { ...columns, updatedAt: now });
  return (await findCreatedRecording(manager, editorialEntityId))!.value[field];
}

/** An artist of a recording, keyed by the recording and the artist. */
export interface RecordingArtistCreditValue {
  rank: ArtistCreditRank;
  position: number;
  creditedAs?: string | null;
}

export async function findRecordingArtistCredit(manager: EntityManager, recordingId: number, artistId: number): Promise<Required<RecordingArtistCreditValue> | null> {
  const row = await manager.findOneBy(RecordingArtistCredit, { recordingId, artistId });
  return row && { rank: row.rank, position: row.position, creditedAs: row.creditedAs };
}

export async function writeRecordingArtistCredit(
  manager: EntityManager,
  recordingId: number,
  artistId: number,
  value: RecordingArtistCreditValue,
  now: Date,
): Promise<void> {
  const columns = { rank: value.rank, position: value.position, creditedAs: value.creditedAs ?? null };
  if (await manager.existsBy(RecordingArtistCredit, { recordingId, artistId })) {
    await manager.update(RecordingArtistCredit, { recordingId, artistId }, { ...columns, updatedAt: now });
  } else {
    await manager.insert(RecordingArtistCredit, { recordingId, artistId, ...columns, createdAt: now, updatedAt: now });
  }
  await touchRecording(manager, recordingId, now);
}

export async function deleteRecordingArtistCredit(manager: EntityManager, recordingId: number, artistId: number, now: Date): Promise<void> {
  await manager.delete(RecordingArtistCredit, { recordingId, artistId });
  await touchRecording(manager, recordingId, now);
}

export async function findRecordingGenre(manager: EntityManager, recordingId: number, genreId: number): Promise<RecordingGenreValue | null> {
  const row = await manager.findOneBy(RecordingGenre, { recordingId, genreId });
  return row && { isPrimary: row.isPrimary };
}

/** What a genre of a recording would break, besides its own row: at most one primary genre. */
export async function recordingGenreClashes(manager: EntityManager, recordingId: number, genreId: number, value: RecordingGenreValue): Promise<string[]> {
  if (!value.isPrimary || !(await manager.existsBy(RecordingGenre, { recordingId, isPrimary: true, genreId: Not(genreId) }))) return [];
  return ['La grabación ya tiene un género primario'];
}

export async function writeRecordingGenre(manager: EntityManager, recordingId: number, genreId: number, value: RecordingGenreValue, now: Date): Promise<void> {
  if (await manager.existsBy(RecordingGenre, { recordingId, genreId })) {
    await manager.update(RecordingGenre, { recordingId, genreId }, { isPrimary: value.isPrimary, updatedAt: now });
  } else {
    await manager.insert(RecordingGenre, { recordingId, genreId, isPrimary: value.isPrimary, createdAt: now, updatedAt: now });
  }
  await touchRecording(manager, recordingId, now);
}

export async function deleteRecordingGenre(manager: EntityManager, recordingId: number, genreId: number, now: Date): Promise<void> {
  await manager.delete(RecordingGenre, { recordingId, genreId });
  await touchRecording(manager, recordingId, now);
}

export async function findRecordingWork(manager: EntityManager, recordingId: number, id: number): Promise<RecordingWorkValue | null> {
  const row = await manager.findOneBy(RecordingWork, { recordingId, id });
  return row && recordingWorkValue(manager, row);
}

/** The link of a recording to a work in a way, which their uniqueness makes unambiguous. */
export async function findRecordingWorkByWork(manager: EntityManager, recordingId: number, value: RecordingWorkValue): Promise<RecordingWorkValue | null> {
  const workId = await workIdOfRoot(manager, value.work.entity_id);
  if (workId === null) return null;
  const row = await manager.findOneBy(RecordingWork, { recordingId, workId, relationType: value.relationType });
  return row && recordingWorkValue(manager, row);
}

/** What a link would break besides the row it replaces: one link per work and way. */
export async function recordingWorkClashes(manager: EntityManager, recordingId: number, value: RecordingWorkValue, replacedId: number | null): Promise<string[]> {
  const workId = await workIdOfRoot(manager, value.work.entity_id);
  if (workId === null) return [];
  const others = replacedId === null ? {} : { id: Not(replacedId) };
  if (!(await manager.existsBy(RecordingWork, { recordingId, workId, relationType: value.relationType, ...others }))) return [];
  return [`La grabación ya tiene la relación ${value.relationType} con esa obra`];
}

export async function insertRecordingWork(manager: EntityManager, recordingId: number, value: RecordingWorkValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(RecordingWork, { recordingId, ...(await linkColumns(manager, value)), createdAt: now, updatedAt: now });
  await touchRecording(manager, recordingId, now);
  return identifiers[0].id as number;
}

export async function updateRecordingWork(manager: EntityManager, recordingId: number, id: number, value: RecordingWorkValue, now: Date): Promise<void> {
  await manager.update(RecordingWork, { recordingId, id }, { ...(await linkColumns(manager, value)), updatedAt: now });
  await touchRecording(manager, recordingId, now);
}

export async function deleteRecordingWork(manager: EntityManager, recordingId: number, id: number, now: Date): Promise<void> {
  await manager.delete(RecordingWork, { recordingId, id });
  await touchRecording(manager, recordingId, now);
}

async function recordingWorkValue(manager: EntityManager, row: RecordingWork): Promise<RecordingWorkValue> {
  const work = await manager.findOneOrFail(Work, { select: { editorialEntityId: true }, where: { id: row.workId } });
  return {
    work: { entity_id: work.editorialEntityId },
    relationType: row.relationType,
    position: row.position,
    details: row.details,
    sourceText: row.sourceText,
    sourceUrl: row.sourceUrl,
  };
}

async function linkColumns(manager: EntityManager, value: RecordingWorkValue) {
  return {
    workId: (await workIdOfRoot(manager, value.work.entity_id))!,
    relationType: value.relationType,
    position: value.position ?? null,
    details: value.details ?? null,
    sourceText: value.sourceText ?? null,
    sourceUrl: value.sourceUrl ?? null,
  };
}

async function workIdOfRoot(manager: EntityManager, editorialEntityId: string): Promise<string | null> {
  const work = await manager.findOne(Work, { select: { id: true }, where: { editorialEntityId: editorialEntityId.toLowerCase() } });
  return work?.id ?? null;
}

async function touchRecording(manager: EntityManager, recordingId: number, now: Date): Promise<void> {
  await manager.update(Recording, { id: recordingId }, { updatedAt: now });
}
