import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { Track, TrackArtistCredit } from './entities/track.entity';
import { RecordingArtistCreditEntry, RecordingEntry, recordingArtistCreditSchema, recordingSchema } from './music.resource';
import { ReleaseEntry, releaseSchema } from './release.resource';
import { ToManyLinkage, ToOneLinkage, creditedName, isWithdrawn } from './resource-primitives';

/*
 * The public resources of tracks and their printed credits. A track is no
 * editorial root: it is shown while its release is published. Reached as the
 * target of a relationship it carries no credits (`relations` undefined). Its
 * platform links are its recording's (ADR 0009).
 */

export interface TrackEntry {
  track: Track;
  /** Its release and recording, without relations; either may show only its withdrawal notice. */
  release: ReleaseEntry;
  recording: RecordingEntry;
  relations?: {
    /** The credit it shows (ADR 0008): its printed credit, or else the artist credit of its recording, by position. */
    artistCredits: (TrackArtistCreditEntry | RecordingArtistCreditEntry)[];
  };
}

/** A printed credit of a track. */
export interface TrackArtistCreditEntry {
  credit: TrackArtistCredit;
  artist: ArtistEntry;
}

export const trackArtistCreditSchema: ResourceSchema<TrackArtistCreditEntry> = defineResource({
  type: 'track-artist-credits',
  id: ({ credit, artist }) => `${credit.trackId}.${artist.artist.publicId}`,
  attributes: {
    rank: ({ credit }) => credit.rank,
    position: ({ credit }) => credit.position,
    creditedAs: ({ credit }) => credit.creditedAs,
    displayName: ({ credit, artist }) => creditedName(credit.creditedAs, artist),
  },
  relationships: { artist: { schema: () => artistSchema, get: ({ artist }) => artist } },
});

const isPrinted = (entry: unknown): entry is TrackArtistCreditEntry => (entry as TrackArtistCreditEntry).credit instanceof TrackArtistCredit;

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
    artistCredits: {
      schema: () => trackArtistCreditSchema,
      // The type of each credit tells a printed one from one the recording lends.
      polymorphic: { others: () => [recordingArtistCreditSchema], of: (credit) => (isPrinted(credit) ? trackArtistCreditSchema : recordingArtistCreditSchema) },
      get: ({ relations }) => relations?.artistCredits,
    },
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
  @ApiProperty({ type: ToOneLinkage, description: '`releases`: su edición' })
  release: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`recordings`' })
  recording: ToOneLinkage;

  @ApiProperty({
    type: ToManyLinkage,
    required: false,
    description:
      'Los artistas que muestra, por `position`: su crédito impreso (`track-artist-credits`) si lo tiene y, si no, el crédito de ' +
      'artista de su grabación (`recording-artist-credits`), leído al mostrarla; vacío si la grabación está retirada',
  })
  artistCredits?: ToManyLinkage;
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
