import { EntityManager, In } from 'typeorm';
import { recordingArtistCreditEntries, trackArtistCreditEntries } from './artist-credit-entries';
import { Recording } from './entities/recording.entity';
import { Edition } from './entities/edition.entity';
import { Track } from './entities/track.entity';
import { withPlatformLinks } from './platform-link-entries';
import { recordingReleaseDates } from './release-dates';
import { editionEntries } from './release-entries';
import { isWithdrawn } from './resource-primitives';
import { TrackEntry } from './track.resource';

/*
 * Loads tracks as entries with their edition and recording, and, for the
 * primary data, the artist credit each shows and the platform links of its
 * recording. The edition and the recording carry no relations of their own,
 * as an include reaches at most two levels.
 */

export async function trackEntries(manager: EntityManager, tracks: Track[], now: Date, withRelations = true): Promise<TrackEntry[]> {
  if (tracks.length === 0) return [];
  const ids = tracks.map(({ id }) => id);
  const recordings = await manager.find(Recording, {
    where: { id: In([...new Set(tracks.map(({ recordingId }) => recordingId))]) },
    relations: { editorialEntity: true },
  });
  const releaseDates = await recordingReleaseDates(manager, recordings.map(({ id }) => id));
  // A tracklist shows where each recording can be heard (ADR 0009); a recording reached otherwise carries no links.
  const shownRecordings = withRelations
    ? await withPlatformLinks(manager, recordings.map((recording) => ({ recording, releaseDate: releaseDates.get(recording.id)! })))
    : recordings.map((recording) => ({ recording, releaseDate: releaseDates.get(recording.id)! }));
  const editions = await editionEntries(
    manager,
    await manager.find(Edition, { where: { id: In([...new Set(tracks.map(({ editionId }) => editionId))]) }, relations: { editorialEntity: true } }),
    now,
    false,
  );
  const printed = withRelations ? await trackArtistCreditEntries(manager, ids) : [];
  // A track without a printed credit shows its recording's, read now and never copied; a withdrawn recording lends none.
  const unprinted = new Set(tracks.filter(({ id }) => !printed.some(({ credit }) => credit.trackId === id)).map(({ recordingId }) => recordingId));
  const lent = withRelations ? await recordingArtistCreditEntries(manager, recordings.filter((recording) => unprinted.has(recording.id) && !isWithdrawn(recording))) : [];
  return tracks.map((track) => {
    if (!withRelations) return { track, ...ends(track) };
    const own = printed.filter(({ credit }) => credit.trackId === track.id);
    return {
      track,
      ...ends(track),
      relations: { artistCredits: own.length > 0 ? own : lent.filter(({ credit }) => credit.recordingId === track.recordingId) },
    };
  });

  function ends(track: Track) {
    return {
      edition: editions.find(({ edition }) => edition.id === track.editionId)!,
      recording: shownRecordings.find(({ recording }) => recording.id === track.recordingId)!,
    };
  }
}
