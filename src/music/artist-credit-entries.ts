import { EntityManager, In } from 'typeorm';
import { ArtistEntry } from '../catalog-identities/artist.resource';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { Recording, RecordingArtistCredit } from './entities/recording.entity';
import { TrackArtistCredit } from './entities/track.entity';
import { RecordingArtistCreditEntry } from './music.resource';
import { TrackArtistCreditEntry } from './track.resource';

/*
 * Loads the artist credits of recordings and the printed credits of tracks
 * (ADR 0008), by position, with their artists and identities, so each shows
 * its name without another include.
 */

/** The artist credits of the recordings, by position. */
export async function recordingArtistCreditEntries(manager: EntityManager, recordings: Recording[]): Promise<RecordingArtistCreditEntry[]> {
  if (recordings.length === 0) return [];
  const credits = await manager.find(RecordingArtistCredit, {
    where: { recordingId: In(recordings.map(({ id }) => id)) },
    order: { position: 'ASC', artistId: 'ASC' },
  });
  const artists = await artistEntries(manager, credits.map(({ artistId }) => artistId));
  return credits.map((credit) => ({ credit, recording: recordings.find(({ id }) => id === credit.recordingId)!, artist: artists.get(credit.artistId)! }));
}

/** The printed credits of the tracks, by position. */
export async function trackArtistCreditEntries(manager: EntityManager, trackIds: number[]): Promise<TrackArtistCreditEntry[]> {
  if (trackIds.length === 0) return [];
  const credits = await manager.find(TrackArtistCredit, { where: { trackId: In(trackIds) }, order: { position: 'ASC', artistId: 'ASC' } });
  const artists = await artistEntries(manager, credits.map(({ artistId }) => artistId));
  return credits.map((credit) => ({ credit, artist: artists.get(credit.artistId)! }));
}

async function artistEntries(manager: EntityManager, ids: number[]): Promise<Map<number, ArtistEntry>> {
  if (ids.length === 0) return new Map();
  const artists = await manager.find(Artist, { where: { id: In([...new Set(ids)]) } });
  const identities = await identityEntriesById(manager, artists.map(({ catalogIdentityId }) => catalogIdentityId));
  return new Map(artists.map((artist) => [artist.id, { artist, identity: identities.get(artist.catalogIdentityId)! }]));
}
