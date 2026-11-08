import { EntityManager, In } from 'typeorm';
import { recordingArtistCreditEntries, trackArtistCreditEntries } from './artist-credit-entries';
import { Recording } from './entities/recording.entity';
import { Release } from './entities/release.entity';
import { Track, TrackPlatformLink } from './entities/track.entity';
import { recordingReleaseDates } from './release-dates';
import { releaseEntries } from './release-entries';
import { isWithdrawn } from './resource-primitives';
import { TrackEntry } from './track.resource';

/*
 * Loads tracks as entries with their release and recording, and, for the
 * primary data, the artist credit each shows and their platform links. The
 * release and the recording carry no relations of their own, as an include
 * reaches at most two levels.
 */

export async function trackEntries(manager: EntityManager, tracks: Track[], now: Date, withRelations = true): Promise<TrackEntry[]> {
  if (tracks.length === 0) return [];
  const ids = tracks.map(({ id }) => id);
  const recordings = await manager.find(Recording, {
    where: { id: In([...new Set(tracks.map(({ recordingId }) => recordingId))]) },
    relations: { editorialEntity: true },
  });
  const releaseDates = await recordingReleaseDates(manager, recordings.map(({ id }) => id));
  const releases = await releaseEntries(
    manager,
    await manager.find(Release, { where: { id: In([...new Set(tracks.map(({ releaseId }) => releaseId))]) }, relations: { editorialEntity: true } }),
    now,
    false,
  );
  const printed = withRelations ? await trackArtistCreditEntries(manager, ids) : [];
  // A track without a printed credit shows its recording's, read now and never copied; a withdrawn recording lends none.
  const unprinted = new Set(tracks.filter(({ id }) => !printed.some(({ credit }) => credit.trackId === id)).map(({ recordingId }) => recordingId));
  const lent = withRelations ? await recordingArtistCreditEntries(manager, recordings.filter((recording) => unprinted.has(recording.id) && !isWithdrawn(recording))) : [];
  const links = withRelations
    ? await manager.find(TrackPlatformLink, { where: { trackId: In(ids) }, relations: { platform: true }, order: { id: 'ASC' } })
    : [];
  return tracks.map((track) => {
    if (!withRelations) return { track, ...ends(track) };
    const own = printed.filter(({ credit }) => credit.trackId === track.id);
    return {
      track,
      ...ends(track),
      relations: {
        artistCredits: own.length > 0 ? own : lent.filter(({ credit }) => credit.recordingId === track.recordingId),
        platformLinks: links.filter(({ trackId }) => trackId === track.id),
      },
    };
  });

  function ends(track: Track) {
    return {
      release: releases.find(({ release }) => release.id === track.releaseId)!,
      recording: { recording: recordings.find(({ id }) => id === track.recordingId)!, releaseDate: releaseDates.get(track.recordingId)! },
    };
  }
}
