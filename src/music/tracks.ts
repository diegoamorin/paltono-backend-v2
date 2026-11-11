import { EntityManager, Not } from 'typeorm';
import { ArtistCreditRank, Recording } from './entities/recording.entity';
import { Edition } from './entities/edition.entity';
import { Track, TrackArtistCredit } from './entities/track.entity';
import { recordingIdOf } from './recordings';
import { RootReference } from './releases';

/*
 * The writes of the tracks of an edition, with their printed credits. The
 * editorial flow calls them inside the transaction that
 * applies a microchange of the edition. Every read is scoped to one edition,
 * so a key never reaches the track of another one.
 */

/** A track as its insertion proposes it and its revisions record it; the recording by its editorial root. */
export interface TrackValue {
  recording: RootReference;
  discNumber: number;
  trackNumber: number;
  title?: string | null;
}

/** An artist of the printed credit of a track (ADR 0008), keyed by the track and the artist. */
export interface TrackArtistCreditValue {
  rank: ArtistCreditRank;
  position: number;
  creditedAs?: string | null;
}

// Tracks

export async function findTrack(manager: EntityManager, editionId: number, id: number): Promise<Required<TrackValue> | null> {
  const track = await manager.findOneBy(Track, { id, editionId });
  return track && trackValue(manager, track);
}

/** The track at a position of an edition, which an insertion of that position would collide with. */
export async function findTrackAt(manager: EntityManager, editionId: number, { discNumber, trackNumber }: TrackValue): Promise<Required<TrackValue> | null> {
  const track = await manager.findOneBy(Track, { editionId, discNumber, trackNumber });
  return track && trackValue(manager, track);
}

/** What a track at a position would break besides itself: a position holds one track, whatever selector proposes it. */
export async function trackClashes(manager: EntityManager, editionId: number, { discNumber, trackNumber }: TrackValue, exceptId: number | null): Promise<string[]> {
  const taken = await manager.existsBy(Track, { editionId, discNumber, trackNumber, ...(exceptId === null ? {} : { id: Not(exceptId) }) });
  return taken ? [`La edición ya tiene una pista en el disco ${discNumber}, número ${trackNumber}`] : [];
}

export async function insertTrack(manager: EntityManager, editionId: number, value: TrackValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(Track, { editionId, ...(await trackColumns(manager, value)), createdAt: now, updatedAt: now });
  await touchEdition(manager, editionId, now);
  return identifiers[0].id as number;
}

export async function updateTrack(manager: EntityManager, editionId: number, id: number, value: TrackValue, now: Date): Promise<void> {
  await manager.update(Track, { id, editionId }, { ...(await trackColumns(manager, value)), updatedAt: now });
  await touchEdition(manager, editionId, now);
}

export async function deleteTrack(manager: EntityManager, editionId: number, id: number, now: Date): Promise<void> {
  await manager.delete(Track, { id, editionId });
  await touchEdition(manager, editionId, now);
}

/** What still refers to a track, which keeps it from being removed: foreign keys are respected, never cascaded. */
export async function trackReferences(manager: EntityManager, editionId: number, id: number): Promise<string[]> {
  if (!(await manager.existsBy(Track, { id, editionId }))) return [];
  const references: string[] = [];
  if (await manager.existsBy(TrackArtistCredit, { trackId: id })) references.push('La pista tiene crédito impreso; quítalo antes de quitar la pista');
  return references;
}

/** Whether a track belongs to an edition. */
export function isTrackOf(manager: EntityManager, editionId: number, id: number): Promise<boolean> {
  return manager.existsBy(Track, { id, editionId });
}

async function trackValue(manager: EntityManager, track: Track): Promise<Required<TrackValue>> {
  const recording = await manager.findOneOrFail(Recording, { select: { editorialEntityId: true }, where: { id: track.recordingId } });
  return { recording: { entity_id: recording.editorialEntityId }, discNumber: track.discNumber, trackNumber: track.trackNumber, title: track.title };
}

/** The columns of a proposed track; its recording is published by the time it applies. */
async function trackColumns(manager: EntityManager, value: TrackValue) {
  return {
    recordingId: (await recordingIdOf(manager, value.recording.entity_id.toLowerCase()))!,
    discNumber: value.discNumber,
    trackNumber: value.trackNumber,
    title: value.title ?? null,
  };
}

// Printed credits

export async function findTrackArtistCredit(manager: EntityManager, editionId: number, trackId: number, artistId: number): Promise<Required<TrackArtistCreditValue> | null> {
  if (!(await isTrackOf(manager, editionId, trackId))) return null;
  const row = await manager.findOneBy(TrackArtistCredit, { trackId, artistId });
  return row && { rank: row.rank, position: row.position, creditedAs: row.creditedAs };
}

export async function writeTrackArtistCredit(
  manager: EntityManager,
  editionId: number,
  trackId: number,
  artistId: number,
  value: TrackArtistCreditValue,
  now: Date,
): Promise<void> {
  const columns = { rank: value.rank, position: value.position, creditedAs: value.creditedAs ?? null };
  if (await manager.existsBy(TrackArtistCredit, { trackId, artistId })) {
    await manager.update(TrackArtistCredit, { trackId, artistId }, { ...columns, updatedAt: now });
  } else {
    await manager.insert(TrackArtistCredit, { trackId, artistId, ...columns, createdAt: now, updatedAt: now });
  }
  await touchEdition(manager, editionId, now);
}

export async function deleteTrackArtistCredit(manager: EntityManager, editionId: number, trackId: number, artistId: number, now: Date): Promise<void> {
  await manager.delete(TrackArtistCredit, { trackId, artistId });
  await touchEdition(manager, editionId, now);
}

async function touchEdition(manager: EntityManager, editionId: number, now: Date): Promise<void> {
  await manager.update(Edition, { id: editionId }, { updatedAt: now });
}
