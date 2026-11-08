import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { PartialDate, partialDateResponse } from '../common/partial-date/partial-date';
import { Genre } from '../vocabularies/entities/genre.entity';
import { GENRES } from '../vocabularies/genres';
import { RECORDING_WORK_RELATION_TYPES, Recording, RecordingArtistCredit, RecordingWork } from './entities/recording.entity';
import { Work } from './entities/work.entity';
import {
  CreditEntry,
  EntryMeta,
  ToManyLinkage,
  ToOneLinkage,
  WITHDRAWN,
  content,
  creditAttributes,
  creditRelationships,
  creditedName,
  isWithdrawn,
} from './resource-primitives';
import { TrackEntry, trackSchema } from './track.resource';

/*
 * The public resources of works and recordings. An entry reached as the
 * target of a relationship carries no relations of its own (`undefined`); a
 * withdrawn entry carries none either (`null`) and shows only its notice.
 */

export interface WorkEntry {
  /** With its editorial root. */
  work: Work;
  /** Derived on each read, whether the work is the primary data or the target of a relationship. */
  firstRecording: FirstRecordingEntry | null;
  relations?: { contributions: CreditEntry[]; recordingWorks: RecordingWorkEntry[] } | null;
}

export interface RecordingEntry {
  /** With its editorial root. */
  recording: Recording;
  /** Derived from its releases on each read, never stored. */
  releaseDate: PartialDate | null;
  relations?: {
    /** By position. */
    artistCredits: RecordingArtistCreditEntry[];
    contributions: CreditEntry[];
    /** The primary genre first. */
    genres: Genre[];
    primaryGenreId: number | null;
    recordingWorks: RecordingWorkEntry[];
    /** Its appearances in published releases, without credits nor links. */
    tracks: TrackEntry[];
  } | null;
}

/**
 * The first recording of a work: of the published recordings that perform it,
 * the one with the earliest release date, those without one after, and by
 * public id on a tie. Samples and interpolations do not count.
 */
export interface FirstRecordingEntry {
  /** Without relations. */
  recording: RecordingEntry;
  /** Its artist credit, by position. */
  artistCredits: RecordingArtistCreditEntry[];
}

export interface RecordingWorkEntry {
  row: RecordingWork;
  work: WorkEntry;
  recording: RecordingEntry;
}

/** An artist of a recording (ADR 0008), with the recording it credits, without its relations. */
export interface RecordingArtistCreditEntry {
  credit: RecordingArtistCredit;
  recording: Recording;
  artist: ArtistEntry;
}

export const recordingArtistCreditSchema: ResourceSchema<RecordingArtistCreditEntry> = defineResource({
  type: 'recording-artist-credits',
  id: ({ recording, artist }) => `${recording.publicId}.${artist.artist.publicId}`,
  attributes: {
    rank: ({ credit }) => credit.rank,
    position: ({ credit }) => credit.position,
    creditedAs: ({ credit }) => credit.creditedAs,
    displayName: ({ credit, artist }) => creditedName(credit.creditedAs, artist),
  },
  relationships: { artist: { schema: () => artistSchema, get: ({ artist }) => artist } },
});

export const workContributionSchema: ResourceSchema<CreditEntry> = defineResource({
  type: 'work-contributions',
  id: ({ credit }) => String(credit.id),
  attributes: creditAttributes,
  relationships: { ...creditRelationships, work: { schema: () => workSchema, get: ({ work }) => work } },
});

export const recordingContributionSchema: ResourceSchema<CreditEntry> = defineResource({
  type: 'recording-contributions',
  id: ({ credit }) => String(credit.id),
  attributes: creditAttributes,
  relationships: { ...creditRelationships, recording: { schema: () => recordingSchema, get: ({ recording }) => recording } },
});

export const recordingWorkSchema: ResourceSchema<RecordingWorkEntry> = defineResource({
  type: 'recording-works',
  id: ({ row }) => String(row.id),
  attributes: {
    relationType: ({ row }) => row.relationType,
    position: ({ row }) => row.position,
    details: ({ row }) => row.details,
    sourceText: ({ row }) => row.sourceText,
    sourceUrl: ({ row }) => row.sourceUrl,
  },
  relationships: {
    recording: { schema: () => recordingSchema, get: ({ recording }) => recording },
    work: { schema: () => workSchema, get: ({ work }) => work },
  },
});

const workContent = <V>(read: (entry: WorkEntry) => V) => content<WorkEntry>(({ work }) => work, read);

export const workSchema: ResourceSchema<WorkEntry> = defineResource({
  type: 'works',
  id: ({ work }) => work.id,
  attributes: {
    publicationStatus: ({ work }) => work.editorialEntity!.publicationStatus,
    withdrawnAt: ({ work }) => work.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: workContent(({ work }) => work.title),
    slug: workContent(({ work }) => work.slug),
    description: workContent(({ work }) => work.description),
    iswc: workContent(({ work }) => work.iswc),
    firstReleaseDate: workContent(({ firstRecording }) => firstRecording?.recording.releaseDate ?? null),
    createdAt: workContent(({ work }) => work.createdAt.toISOString()),
    updatedAt: workContent(({ work }) => work.updatedAt.toISOString()),
  },
  relationships: {
    contributions: { schema: () => workContributionSchema, get: ({ relations }) => relations?.contributions },
    recordingWorks: { schema: () => recordingWorkSchema, get: ({ relations }) => relations?.recordingWorks },
    firstRecording: { schema: () => recordingSchema, get: (entry) => (isWithdrawn(entry.work) ? undefined : (entry.firstRecording?.recording ?? null)) },
    firstRecordingArtistCredits: {
      schema: () => recordingArtistCreditSchema,
      get: (entry) => (isWithdrawn(entry.work) ? undefined : (entry.firstRecording?.artistCredits ?? [])),
    },
  },
  meta: ({ work }) => ({ editorialEntityId: work.editorialEntityId }),
});

const recordingContent = <V>(read: (entry: RecordingEntry) => V) => content<RecordingEntry>(({ recording }) => recording, read);

export const recordingSchema: ResourceSchema<RecordingEntry> = defineResource({
  type: 'recordings',
  id: ({ recording }) => recording.publicId,
  attributes: {
    publicationStatus: ({ recording }) => recording.editorialEntity!.publicationStatus,
    withdrawnAt: ({ recording }) => recording.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: recordingContent(({ recording }) => recording.title),
    description: recordingContent(({ recording }) => recording.description),
    isExplicit: recordingContent(({ recording }) => recording.isExplicit),
    isrc: recordingContent(({ recording }) => recording.isrc),
    recordingDate: recordingContent(({ recording }) => partialDateResponse(recording, 'recording')),
    releaseDate: recordingContent(({ releaseDate }) => releaseDate),
    primaryGenreId: recordingContent(({ relations }) => (relations ? (relations.primaryGenreId === null ? null : String(relations.primaryGenreId)) : undefined)),
    createdAt: recordingContent(({ recording }) => recording.createdAt.toISOString()),
    updatedAt: recordingContent(({ recording }) => recording.updatedAt.toISOString()),
  },
  relationships: {
    artistCredits: { schema: () => recordingArtistCreditSchema, get: ({ relations }) => relations?.artistCredits },
    contributions: { schema: () => recordingContributionSchema, get: ({ relations }) => relations?.contributions },
    genres: { schema: () => GENRES.schema, get: ({ relations }) => relations?.genres },
    recordingWorks: { schema: () => recordingWorkSchema, get: ({ relations }) => relations?.recordingWorks },
    tracks: { schema: () => trackSchema, get: ({ relations }) => relations?.tracks },
  },
  meta: ({ recording }) => ({ editorialEntityId: recording.editorialEntityId }),
});

// Swagger descriptions of the resource objects.

class WorkAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ example: 'Butter', required: false, description: WITHDRAWN })
  title?: string;

  @ApiProperty({ example: 'butter', required: false, description: `Generado desde el título y conservado aunque cambie. ${WITHDRAWN}` })
  slug?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  description?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: 'T0345246801', description: WITHDRAWN })
  iswc?: string | null;

  @ApiProperty({
    type: PartialDate,
    nullable: true,
    required: false,
    description: `Fecha de lanzamiento de su primera grabación (\`firstRecording\`); null sin ella o si no tiene fecha. ${WITHDRAWN}`,
  })
  firstReleaseDate?: PartialDate | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class WorkRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`work-contributions`, por `position`' })
  contributions: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`recording-works`: grabaciones que interpretan, interpolan o samplean la obra' })
  recordingWorks: ToManyLinkage;

  @ApiProperty({
    type: ToOneLinkage,
    description:
      '`recordings`: su primera grabación. Entre las grabaciones publicadas que la interpretan (no samples ni interpolaciones), ' +
      'la de fecha de lanzamiento más temprana; las que no tienen fecha van después y el empate se resuelve por id público. ' +
      'null si ninguna la interpreta.',
  })
  firstRecording: ToOneLinkage;

  @ApiProperty({
    type: ToManyLinkage,
    description: '`recording-artist-credits`: el crédito de artista de su primera grabación, por `position`; vacío sin ella',
  })
  firstRecordingArtistCredits: ToManyLinkage;
}

export class WorkResource {
  @ApiProperty({ enum: ['works'] })
  type: string;

  @ApiProperty({ description: 'id de la obra, como cadena' })
  id: string;

  @ApiProperty({ type: WorkAttributes })
  attributes: WorkAttributes;

  @ApiProperty({ type: WorkRelationships, required: false, description: WITHDRAWN })
  relationships?: WorkRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class RecordingAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ example: 'Butter', required: false, description: WITHDRAWN })
  title?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  description?: string | null;

  @ApiProperty({ required: false, description: WITHDRAWN })
  isExplicit?: boolean;

  @ApiProperty({ type: String, nullable: true, required: false, example: 'USA2P2125949', description: WITHDRAWN })
  isrc?: string | null;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Fecha parcial de grabación. ${WITHDRAWN}` })
  recordingDate?: PartialDate | null;

  @ApiProperty({
    type: PartialDate,
    nullable: true,
    required: false,
    description:
      'Fecha de lanzamiento: la fecha parcial más temprana de sus ediciones publicadas y no canceladas que tienen fecha, ' +
      `incluidas las futuras; null si no tiene. Se calcula al leer. ${WITHDRAWN}`,
  })
  releaseDate?: PartialDate | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: `id del género primario, entre \`genres\`. ${WITHDRAWN}` })
  primaryGenreId?: string | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class RecordingRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`recording-artist-credits`: su crédito de artista, por `position`' })
  artistCredits: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`recording-contributions`, por `position`' })
  contributions: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`genres`, el primario primero' })
  genres: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`recording-works`, por `position` de medley' })
  recordingWorks: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`tracks`: apariciones en ediciones' })
  tracks: ToManyLinkage;
}

export class RecordingResource {
  @ApiProperty({ enum: ['recordings'] })
  type: string;

  @ApiProperty({ description: 'public_id de la grabación' })
  id: string;

  @ApiProperty({ type: RecordingAttributes })
  attributes: RecordingAttributes;

  @ApiProperty({ type: RecordingRelationships, required: false, description: WITHDRAWN })
  relationships?: RecordingRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class CreditAttributes {
  @ApiProperty({ type: String, nullable: true, description: 'Nombre literal de la fuente; null muestra el nombre visible de la identidad' })
  creditedAs: string | null;

  @ApiProperty({ description: 'Orden editorial, no importancia ni porcentaje' })
  position: number;

  @ApiProperty({ type: String, nullable: true })
  details: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceText: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceUrl: string | null;
}

class CreditRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`identities`' })
  identity: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`contribution-roles`' })
  role: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, required: false, description: '`works`, en un crédito de obra' })
  work?: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, required: false, description: '`recordings`, en un crédito de grabación' })
  recording?: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, required: false, description: '`releases`, en un crédito de edición' })
  release?: ToOneLinkage;
}

export class CreditResource {
  @ApiProperty({ enum: ['work-contributions', 'recording-contributions', 'release-contributions'] })
  type: string;

  @ApiProperty({ description: 'PK entera del crédito, como cadena' })
  id: string;

  @ApiProperty({ type: CreditAttributes })
  attributes: CreditAttributes;

  @ApiProperty({ type: CreditRelationships })
  relationships: CreditRelationships;
}

export const RELATION_TYPES = RECORDING_WORK_RELATION_TYPES;
