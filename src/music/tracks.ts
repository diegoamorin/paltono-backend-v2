import { EntityManager, Not } from 'typeorm';
import { Recording } from './entities/recording.entity';
import { Release } from './entities/release.entity';
import { Track, TrackArtistCredit, TrackArtistRank, TrackPlatformLink } from './entities/track.entity';
import { recordingIdOf } from './recordings';
import { RootReference } from './releases';

/*
 * The writes of the tracks of a release, with their presentation credits and
 * platform links. The editorial flow calls them inside the transaction that
 * applies a microchange of the release. Every read is scoped to one release,
 * so a key never reaches the track of another one.
 */

/** A track as its insertion proposes it and its revisions record it; the recording by its editorial root. */
export interface TrackValue {
  recording: RootReference;
  discNumber: number;
  trackNumber: number;
  title?: string | null;
}

/** A presentation credit of a track, keyed by the track and the artist. */
export interface TrackArtistCreditValue {
  rank: TrackArtistRank;
  position: number;
  creditedAs?: string | null;
}

export interface TrackPlatformLinkValue {
  platformId: number;
  url: string;
}

// Tracks

export async function findTrack(manager: EntityManager, releaseId: number, id: number): Promise<Required<TrackValue> | null> {
  const track = await manager.findOneBy(Track, { id, releaseId });
  return track && trackValue(manager, track);
}

/** The track at a position of a release, which an insertion of that position would collide with. */
export async function findTrackAt(manager: EntityManager, releaseId: number, { discNumber, trackNumber }: TrackValue): Promise<Required<TrackValue> | null> {
  const track = await manager.findOneBy(Track, { releaseId, discNumber, trackNumber });
  return track && trackValue(manager, track);
}

/** What a track at a position would break besides itself: a position holds one track, whatever selector proposes it. */
export async function trackClashes(manager: EntityManager, releaseId: number, { discNumber, trackNumber }: TrackValue, exceptId: number | null): Promise<string[]> {
  const taken = await manager.existsBy(Track, { releaseId, discNumber, trackNumber, ...(exceptId === null ? {} : { id: Not(exceptId) }) });
  return taken ? [`La edición ya tiene una pista en el disco ${discNumber}, número ${trackNumber}`] : [];
}

export async function insertTrack(manager: EntityManager, releaseId: number, value: TrackValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(Track, { releaseId, ...(await trackColumns(manager, value)), createdAt: now, updatedAt: now });
  await touchRelease(manager, releaseId, now);
  return identifiers[0].id as number;
}

export async function updateTrack(manager: EntityManager, releaseId: number, id: number, value: TrackValue, now: Date): Promise<void> {
  await manager.update(Track, { id, releaseId }, { ...(await trackColumns(manager, value)), updatedAt: now });
  await touchRelease(manager, releaseId, now);
}

export async function deleteTrack(manager: EntityManager, releaseId: number, id: number, now: Date): Promise<void> {
  await manager.delete(Track, { id, releaseId });
  await touchRelease(manager, releaseId, now);
}

/** What still refers to a track, which keeps it from being removed: foreign keys are respected, never cascaded. */
export async function trackReferences(manager: EntityManager, releaseId: number, id: number): Promise<string[]> {
  if (!(await manager.existsBy(Track, { id, releaseId }))) return [];
  const references: string[] = [];
  if (await manager.existsBy(TrackArtistCredit, { trackId: id })) references.push('La pista tiene créditos de presentación; quítalos antes de quitar la pista');
  if (await manager.existsBy(TrackPlatformLink, { trackId: id })) references.push('La pista tiene enlaces a plataformas; quítalos antes de quitar la pista');
  return references;
}

/** Whether a track belongs to a release. */
export function isTrackOf(manager: EntityManager, releaseId: number, id: number): Promise<boolean> {
  return manager.existsBy(Track, { id, releaseId });
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

// Presentation credits

export async function findTrackArtistCredit(manager: EntityManager, releaseId: number, trackId: number, artistId: number): Promise<Required<TrackArtistCreditValue> | null> {
  if (!(await isTrackOf(manager, releaseId, trackId))) return null;
  const row = await manager.findOneBy(TrackArtistCredit, { trackId, artistId });
  return row && { rank: row.rank, position: row.position, creditedAs: row.creditedAs };
}

export async function writeTrackArtistCredit(
  manager: EntityManager,
  releaseId: number,
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
  await touchRelease(manager, releaseId, now);
}

export async function deleteTrackArtistCredit(manager: EntityManager, releaseId: number, trackId: number, artistId: number, now: Date): Promise<void> {
  await manager.delete(TrackArtistCredit, { trackId, artistId });
  await touchRelease(manager, releaseId, now);
}

// Platform links

export async function findTrackLink(manager: EntityManager, releaseId: number, id: number): Promise<TrackPlatformLinkValue | null> {
  const link = await linkOf(manager, releaseId, id);
  return link && { platformId: link.platformId, url: link.url };
}

/** The link of a track that an insertion of the same platform and URL would collide with. */
export async function findTrackLinkByUrl(manager: EntityManager, trackId: number, { platformId, url }: TrackPlatformLinkValue): Promise<TrackPlatformLinkValue | null> {
  const link = await manager.findOneBy(TrackPlatformLink, { trackId, platformId, url });
  return link && { platformId: link.platformId, url: link.url };
}

/** What a link would break besides itself: a platform and URL appear once per track. */
export async function trackLinkClashes(manager: EntityManager, trackId: number, { platformId, url }: TrackPlatformLinkValue, exceptId: number | null): Promise<string[]> {
  const taken = await manager.existsBy(TrackPlatformLink, { trackId, platformId, url, ...(exceptId === null ? {} : { id: Not(exceptId) }) });
  return taken ? ['La pista ya tiene este enlace en esta plataforma'] : [];
}

/** The track of an existing link of a release, or null. */
export async function trackOfLink(manager: EntityManager, releaseId: number, id: number): Promise<number | null> {
  return (await linkOf(manager, releaseId, id))?.trackId ?? null;
}

function linkOf(manager: EntityManager, releaseId: number, id: number): Promise<TrackPlatformLink | null> {
  return manager
    .createQueryBuilder(TrackPlatformLink, 'link')
    .innerJoin(Track, 'track', 'track.id = link.track_id')
    .where('link.id = :id AND track.release_id = :releaseId', { id, releaseId })
    .getOne();
}

export async function insertTrackLink(manager: EntityManager, releaseId: number, trackId: number, value: TrackPlatformLinkValue, now: Date): Promise<number> {
  const { identifiers } = await manager.insert(TrackPlatformLink, { trackId, platformId: value.platformId, url: value.url, createdAt: now, updatedAt: now });
  await touchRelease(manager, releaseId, now);
  return identifiers[0].id as number;
}

export async function updateTrackLink(manager: EntityManager, releaseId: number, id: number, value: TrackPlatformLinkValue, now: Date): Promise<void> {
  await manager.update(TrackPlatformLink, { id }, { platformId: value.platformId, url: value.url, updatedAt: now });
  await touchRelease(manager, releaseId, now);
}

export async function deleteTrackLink(manager: EntityManager, releaseId: number, id: number, now: Date): Promise<void> {
  await manager.delete(TrackPlatformLink, { id });
  await touchRelease(manager, releaseId, now);
}

async function touchRelease(manager: EntityManager, releaseId: number, now: Date): Promise<void> {
  await manager.update(Release, { id: releaseId }, { updatedAt: now });
}
