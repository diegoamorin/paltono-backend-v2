import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { PartialDate, partialDateResponse } from '../common/partial-date/partial-date';
import { SHOWN_IMAGE_DESCRIPTION, ShownImage } from '../images/shown-images';
import { Edition } from './entities/edition.entity';
import { RELEASE_TYPES, Release, ReleaseArtistCredit } from './entities/release.entity';
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
import { EDITION_AVAILABILITIES, EditionTimes, ReleaseDates } from './release-dates';

/*
 * The public resources of releases and editions. An entry reached as the
 * target of a relationship carries no relations of its own (`undefined`); a
 * withdrawn entry carries none either (`null`) and shows only its notice.
 * Dates, upcoming state and availability are derived on each read.
 */

export interface ReleaseEntry {
  /** With its editorial root. */
  release: Release;
  dates: ReleaseDates;
  /**
   * Its artist credit, by position: loaded along with its relations, and
   * on an entry whose reader offers it (a search result); never on a withdrawn
   * release.
   */
  artistCredits?: ReleaseArtistCreditEntry[];
  relations?: {
    editions: EditionEntry[];
    repackageOf: ReleaseEntry | null;
  } | null;
}

export interface EditionEntry {
  /** With its editorial root. */
  edition: Edition;
  times: EditionTimes;
  /** Derived from the recordings of its tracks, never stored. */
  isExplicit: boolean;
  /** Its release, without relations. */
  release: ReleaseEntry;
  /** Its cover art as the reads show it. */
  coverArt: ShownImage | null;
  relations?: { contributions: CreditEntry[]; tracks: TrackEntry[] } | null;
}

export interface ReleaseArtistCreditEntry {
  credit: ReleaseArtistCredit;
  release: Release;
  artist: ArtistEntry;
}

export const releaseArtistCreditSchema: ResourceSchema<ReleaseArtistCreditEntry> = defineResource({
  type: 'release-artist-credits',
  id: ({ release, artist }) => `${release.publicId}.${artist.artist.publicId}`,
  attributes: {
    position: ({ credit }) => credit.position,
    creditedAs: ({ credit }) => credit.creditedAs,
    displayName: ({ credit, artist }) => creditedName(credit.creditedAs, artist),
  },
  relationships: { artist: { schema: () => artistSchema, get: ({ artist }) => artist } },
});

export const editionContributionSchema: ResourceSchema<CreditEntry> = defineResource({
  type: 'edition-contributions',
  id: ({ credit }) => String(credit.id),
  attributes: creditAttributes,
  relationships: { ...creditRelationships, edition: { schema: () => editionSchema, get: ({ edition }) => edition } },
});

const releaseContent = <V>(read: (entry: ReleaseEntry) => V) => content<ReleaseEntry>(({ release }) => release, read);

export const releaseSchema: ResourceSchema<ReleaseEntry> = defineResource({
  type: 'releases',
  id: ({ release }) => release.publicId,
  attributes: {
    publicationStatus: ({ release }) => release.editorialEntity!.publicationStatus,
    withdrawnAt: ({ release }) => release.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: releaseContent(({ release }) => release.title),
    type: releaseContent(({ release }) => release.type),
    description: releaseContent(({ release }) => release.description),
    releaseDate: releaseContent(({ dates }) => dates.releaseDate),
    upcoming: releaseContent(({ dates }) => dates.upcoming),
    nextReleaseDate: releaseContent(({ dates }) => dates.nextReleaseDate),
    releaseInstant: releaseContent(({ dates }) => dates.releaseInstant?.toISOString() ?? null),
    createdAt: releaseContent(({ release }) => release.createdAt.toISOString()),
    updatedAt: releaseContent(({ release }) => release.updatedAt.toISOString()),
  },
  relationships: {
    artistCredits: { schema: () => releaseArtistCreditSchema, get: ({ artistCredits }) => artistCredits },
    editions: { schema: () => editionSchema, get: ({ relations }) => relations?.editions },
    repackageOf: { schema: () => releaseSchema, get: ({ relations }) => (relations ? relations.repackageOf : undefined) },
  },
  meta: ({ release }) => ({ editorialEntityId: release.editorialEntityId }),
});

const editionContent = <V>(read: (entry: EditionEntry) => V) => content<EditionEntry>(({ edition }) => edition, read);

export const editionSchema: ResourceSchema<EditionEntry> = defineResource({
  type: 'editions',
  id: ({ edition }) => edition.publicId,
  attributes: {
    publicationStatus: ({ edition }) => edition.editorialEntity!.publicationStatus,
    withdrawnAt: ({ edition }) => edition.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: editionContent(({ edition }) => edition.title),
    // The release's title is shown, never copied; a withdrawn release's is not shown at all.
    displayTitle: editionContent(({ edition, release }) => edition.title ?? (isWithdrawn(release.release) ? null : release.release.title)),
    editionName: editionContent(({ edition }) => edition.editionName),
    releaseDate: editionContent(({ edition }) => partialDateResponse(edition, 'release')),
    releaseTime: editionContent(({ edition }) => edition.releaseTime?.slice(0, 5) ?? null),
    timezone: editionContent(({ edition }) => edition.timezone),
    releaseInstant: editionContent(({ times }) => times.instant?.toISOString() ?? null),
    availability: editionContent(({ times }) => times.availability),
    isCancelled: editionContent(({ edition }) => edition.isCancelled),
    isExplicit: editionContent(({ isExplicit }) => isExplicit),
    coverArt: editionContent(({ coverArt }) => coverArt),
    createdAt: editionContent(({ edition }) => edition.createdAt.toISOString()),
    updatedAt: editionContent(({ edition }) => edition.updatedAt.toISOString()),
  },
  relationships: {
    release: { schema: () => releaseSchema, get: (entry) => (isWithdrawn(entry.edition) ? undefined : entry.release) },
    tracks: { schema: () => trackSchema, get: ({ relations }) => relations?.tracks },
    contributions: { schema: () => editionContributionSchema, get: ({ relations }) => relations?.contributions },
  },
  meta: ({ edition }) => ({ editorialEntityId: edition.editorialEntityId }),
});

// Swagger descriptions of the resource objects.

class ReleaseAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ example: 'BE', required: false, description: WITHDRAWN })
  title?: string;

  @ApiProperty({ enum: RELEASE_TYPES, required: false, description: `Como lo anunció su artista o agencia. ${WITHDRAWN}` })
  type?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  description?: string | null;

  @ApiProperty({
    type: PartialDate,
    nullable: true,
    required: false,
    description: `Derivada: la fecha más temprana de sus ediciones publicadas y no canceladas. ${WITHDRAWN}`,
  })
  releaseDate?: PartialDate | null;

  @ApiProperty({ required: false, description: `Derivado: tiene ediciones con fecha y ninguna ha salido todavía. ${WITHDRAWN}` })
  upcoming?: boolean;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Derivada: la fecha de su próxima edición por salir. ${WITHDRAWN}` })
  nextReleaseDate?: PartialDate | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    required: false,
    description: `Derivado: instante de salida de su primera edición próxima con hora y zona, para la cuenta regresiva. ${WITHDRAWN}`,
  })
  releaseInstant?: string | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class ReleaseRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`release-artist-credits`, por `position`' })
  artistCredits: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`editions`: sus ediciones publicadas' })
  editions: ToManyLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`releases`: el lanzamiento original de un repackage, o null' })
  repackageOf: ToOneLinkage;
}

export class ReleaseResource {
  @ApiProperty({ enum: ['releases'] })
  type: string;

  @ApiProperty({ description: 'public_id del lanzamiento' })
  id: string;

  @ApiProperty({ type: ReleaseAttributes })
  attributes: ReleaseAttributes;

  @ApiProperty({ type: ReleaseRelationships, required: false, description: WITHDRAWN })
  relationships?: ReleaseRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class EditionAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: `Título literal de la edición. ${WITHDRAWN}` })
  title?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: `Su título o, si no tiene, el del lanzamiento. ${WITHDRAWN}` })
  displayTitle?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: 'Deluxe', description: `null en la edición estándar. ${WITHDRAWN}` })
  editionName?: string | null;

  @ApiProperty({ type: PartialDate, nullable: true, required: false, description: `Fecha parcial de salida. ${WITHDRAWN}` })
  releaseDate?: PartialDate | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: '18:00', description: `Hora local anunciada, HH:MM. ${WITHDRAWN}` })
  releaseTime?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, example: 'Asia/Seoul', description: `Zona IANA de la hora. ${WITHDRAWN}` })
  timezone?: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    required: false,
    description: `Derivado: instante de salida, con hora y zona. ${WITHDRAWN}`,
  })
  releaseInstant?: string | null;

  @ApiProperty({
    enum: EDITION_AVAILABILITIES,
    required: false,
    description: `Derivada: cancelada; próxima o publicada según su instante o el primer día de su fecha; desconocida sin fecha. ${WITHDRAWN}`,
  })
  availability?: string;

  @ApiProperty({ required: false, description: WITHDRAWN })
  isCancelled?: boolean;

  @ApiProperty({ required: false, description: `Derivado: alguna de sus pistas usa una grabación explícita. ${WITHDRAWN}` })
  isExplicit?: boolean;

  @ApiProperty({ type: ShownImage, nullable: true, required: false, description: `Portada. ${SHOWN_IMAGE_DESCRIPTION}. ${WITHDRAWN}` })
  coverArt?: ShownImage | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class EditionRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`releases`: su lanzamiento' })
  release: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`tracks`, por disco y número' })
  tracks: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`edition-contributions`, por `position`' })
  contributions: ToManyLinkage;
}

export class EditionResource {
  @ApiProperty({ enum: ['editions'] })
  type: string;

  @ApiProperty({ description: 'public_id de la edición' })
  id: string;

  @ApiProperty({ type: EditionAttributes })
  attributes: EditionAttributes;

  @ApiProperty({ type: EditionRelationships, required: false, description: WITHDRAWN })
  relationships?: EditionRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}
