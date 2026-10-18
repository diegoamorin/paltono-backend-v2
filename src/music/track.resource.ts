import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { PLATFORMS } from '../vocabularies/platforms';
import { Track,TrackArtistCredit, TrackPlatformLink } from './entities/track.entity';
import { RecordingEntry, ToManyLinkage, ToOneLinkage, recordingSchema } from './music.resource';
import { ReleaseEntry, releaseSchema } from './release.resource';

/*
 * The public resources of tracks, their presentation credits and platform
 * links. A track is no editorial root: it is shown while its release is
 * published. Reached as the target of a relationship it carries no credits
 * nor links (`relations` undefined).
 */

export interface TrackEntry {
  track: Track;
  /** Its release and recording, without relations; either may show only its withdrawal notice. */
  release: ReleaseEntry;
  recording: RecordingEntry;
  relations?: { artistCredits: TrackArtistCreditEntry[]; platformLinks: TrackPlatformLink[] };
}

export interface TrackArtistCreditEntry {
  credit: TrackArtistCredit;
  artist: ArtistEntry;
}

const isWithdrawn = (root: { editorialEntity?: { publicationStatus: string } }) => root.editorialEntity!.publicationStatus === 'withdrawn';

export const trackArtistCreditSchema: ResourceSchema<TrackArtistCreditEntry> = defineResource({
  type: 'track-artist-credits',
  id: ({ credit, artist }) => `${credit.trackId}.${artist.artist.publicId}`,
  attributes: {
    rank: ({ credit }) => credit.rank,
    position: ({ credit }) => credit.position,
    creditedAs: ({ credit }) => credit.creditedAs,
  },
  relationships: { artist: { schema: () => artistSchema, get: ({ artist }) => artist } },
});

export const trackPlatformLinkSchema: ResourceSchema<TrackPlatformLink> = defineResource({
  type: 'track-platform-links',
  id: (link) => String(link.id),
  attributes: { url: (link) => link.url },
  relationships: { platform: { schema: () => PLATFORMS.schema, get: (link) => link.platform } },
});

export const trackSchema: ResourceSchema<TrackEntry> = defineResource({
  type: 'tracks',
  id: ({ track }) => String(track.id),
  attributes: {
    discNumber: ({ track }) => track.discNumber,
    trackNumber: ({ track }) => track.trackNumber,
    title: ({ track }) => track.title,
    // The recording's current title is shown, never copied; a withdrawn recording's is not shown at all.
    displayTitle: ({ track, recording }) => track.title ?? (isWithdrawn(recording.recording) ? null : recording.recording.title),
  },
  relationships: {
    release: { schema: () => releaseSchema, get: ({ release }) => release },
    recording: { schema: () => recordingSchema, get: ({ recording }) => recording },
    artistCredits: { schema: () => trackArtistCreditSchema, get: ({ relations }) => relations?.artistCredits },
    platformLinks: { schema: () => trackPlatformLinkSchema, get: ({ relations }) => relations?.platformLinks },
  },
});

// Swagger descriptions of the resource objects.

class TrackAttributes {
  @ApiProperty({ example: 1 })
  discNumber: number;

  @ApiProperty({ example: 3 })
  trackNumber: number;

  @ApiProperty({ type: String, nullable: true, description: 'Título literal de la pista en esta edición' })
  title: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Su título o, si no tiene, el título vigente de la grabación; null si la grabación está retirada' })
  displayTitle: string | null;
}

class TrackRelationships {
  @ApiProperty({ type: () => ToOneLinkage, description: '`releases`: su edición' })
  release: ToOneLinkage;

  @ApiProperty({ type: () => ToOneLinkage, description: '`recordings`' })
  recording: ToOneLinkage;

  @ApiProperty({ type: () => ToManyLinkage, required: false, description: '`track-artist-credits`, por `position`' })
  artistCredits?: ToManyLinkage;

  @ApiProperty({ type: () => ToManyLinkage, required: false, description: '`track-platform-links`' })
  platformLinks?: ToManyLinkage;
}

export class TrackResource {
  @ApiProperty({ enum: ['tracks'] })
  type: string;

  @ApiProperty({ description: 'PK entera de la pista, como cadena' })
  id: string;

  @ApiProperty({ type: TrackAttributes })
  attributes: TrackAttributes;

  @ApiProperty({ type: TrackRelationships })
  relationships: TrackRelationships;
}
