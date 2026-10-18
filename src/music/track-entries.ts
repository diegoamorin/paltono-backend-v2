import { EntityManager, In } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { Recording } from './entities/recording.entity';
import { Release } from './entities/release.entity';
import { Track, TrackArtistCredit, TrackPlatformLink } from './entities/track.entity';
import { releaseEntries } from './release-entries';
import { TrackEntry } from './track.resource';

/*
 * Loads tracks as entries with their release and recording, and, for the
 * primary data, their presentation credits and platform links. The release
 * and the recording carry no relations of their own, as an include reaches at
 * most two levels.
 */

export async function trackEntries(manager: EntityManager, tracks: Track[], now: Date, withRelations = true): Promise<TrackEntry[]> {
  if (tracks.length === 0) return [];
  const ids = tracks.map(({ id }) => id);
  const recordings = await manager.find(Recording, {
    where: { id: In([...new Set(tracks.map(({ recordingId }) => recordingId))]) },
    relations: { editorialEntity: true },
  });
  const releases = await releaseEntries(
    manager,
    await manager.find(Release, { where: { id: In([...new Set(tracks.map(({ releaseId }) => releaseId))]) }, relations: { editorialEntity: true } }),
    now,
    false,
  );
  const credits = withRelations ? await artistCreditEntries(manager, ids) : [];
  const links = withRelations
    ? await manager.find(TrackPlatformLink, { where: { trackId: In(ids) }, relations: { platform: true }, order: { id: 'ASC' } })
    : [];
  return tracks.map((track) => ({
    track,
    release: releases.find(({ release }) => release.id === track.releaseId)!,
    recording: { recording: recordings.find(({ id }) => id === track.recordingId)! },
    ...(withRelations
      ? {
          relations: {
            artistCredits: credits.filter(({ credit }) => credit.trackId === track.id),
            platformLinks: links.filter(({ trackId }) => trackId === track.id),
          },
        }
      : {}),
  }));
}

/** The presentation credits of the tracks, by position, with their artists and identities. */
async function artistCreditEntries(manager: EntityManager, trackIds: number[]) {
  const credits = await manager.find(TrackArtistCredit, { where: { trackId: In(trackIds) }, order: { position: 'ASC', artistId: 'ASC' } });
  if (credits.length === 0) return [];
  const artists = await manager.find(Artist, { where: { id: In([...new Set(credits.map(({ artistId }) => artistId))]) } });
  const identities = await identityEntriesById(manager, artists.map(({ catalogIdentityId }) => catalogIdentityId));
  return credits.map((credit) => {
    const artist = artists.find(({ id }) => id === credit.artistId)!;
    return { credit, artist: { artist, identity: identities.get(artist.catalogIdentityId)! } };
  });
}
