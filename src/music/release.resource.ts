import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from '../catalog-identities/artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { SHOWN_IMAGE_DESCRIPTION, ShownImage, ShownImageAttributes } from '../images/shown-images';
import { RELEASE_GROUP_TYPES, Release, ReleaseArtistCredit, ReleaseGroup } from './entities/release.entity';
import {
  CreditEntry,
  EntryMeta,
  PartialDate,
  ToManyLinkage,
  ToOneLinkage,
  WITHDRAWN,
  content,
  creditAttributes,
  creditRelationships,
  isWithdrawn,
  partialDate,
} from './resource-primitives';
import { TrackEntry, trackSchema } from './track.resource';
import { RELEASE_AVAILABILITIES, ReleaseGroupDates, ReleaseTimes } from './release-dates';

/*
 * The public resources of release groups and releases. An entry reached as
 * the target of a relationship carries no relations of its own (`undefined`);
 * a withdrawn entry carries none either (`null`) and shows only its notice.
 * Dates, upcoming state and availability are derived on each read.
 */

export interface ReleaseGroupEntry {
  /** With its editorial root. */
  group: ReleaseGroup;
  dates: ReleaseGroupDates;
  relations?: {
    artistCredits: ReleaseArtistCreditEntry[];
    releases: ReleaseEntry[];
    repackageOf: ReleaseGroupEntry | null;
  } | null;
}

export interface ReleaseEntry {
  /** With its editorial root. */
  release: Release;
  times: ReleaseTimes;
  /** Derived from the recordings of its tracks, never stored. */
  isExplicit: boolean;
  /** Its release group, without relations. */
  group: ReleaseGroupEntry;
  /** Its cover art as the reads show it. */
  coverArt: ShownImage | null;
  relations?: { contributions: CreditEntry[]; tracks: TrackEntry[] } | null;
}

export interface ReleaseArtistCreditEntry {
  credit: ReleaseArtistCredit;
  group: ReleaseGroup;
  artist: ArtistEntry;
}

export const releaseArtistCreditSchema: ResourceSchema<ReleaseArtistCreditEntry> = defineResource({
  type: 'release-artist-credits',
  id: ({ group, artist }) => `${group.publicId}.${artist.artist.publicId}`,
  attributes: {
    position: ({ credit }) => credit.position,
    creditedAs: ({ credit }) => credit.creditedAs,
  },
  relationships: { artist: { schema: () => artistSchema, get: ({ artist }) => artist } },
});

export const releaseContributionSchema: ResourceSchema<CreditEntry> = defineResource({
  type: 'release-contributions',
  id: ({ credit }) => String(credit.id),
  attributes: creditAttributes,
  relationships: { ...creditRelationships, release: { schema: () => releaseSchema, get: ({ release }) => release } },
});

const groupContent = <V>(read: (entry: ReleaseGroupEntry) => V) => content<ReleaseGroupEntry>(({ group }) => group, read);

export const releaseGroupSchema: ResourceSchema<ReleaseGroupEntry> = defineResource({
  type: 'release-groups',
  id: ({ group }) => group.publicId,
  attributes: {
    publicationStatus: ({ group }) => group.editorialEntity!.publicationStatus,
    withdrawnAt: ({ group }) => group.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: groupContent(({ group }) => group.title),
    type: groupContent(({ group }) => group.type),
    description: groupContent(({ group }) => group.description),
    releaseDate: groupContent(({ dates }) => dates.releaseDate),
    upcoming: groupContent(({ dates }) => dates.upcoming),
    nextReleaseDate: groupContent(({ dates }) => dates.nextReleaseDate),
    releaseInstant: groupContent(({ dates }) => dates.releaseInstant?.toISOString() ?? null),
    createdAt: groupContent(({ group }) => group.createdAt.toISOString()),
    updatedAt: groupContent(({ group }) => group.updatedAt.toISOString()),
  },
  relationships: {
    artistCredits: { schema: () => releaseArtistCreditSchema, get: ({ relations }) => relations?.artistCredits },
    releases: { schema: () => releaseSchema, get: ({ relations }) => relations?.releases },
    repackageOf: { schema: () => releaseGroupSchema, get: ({ relations }) => (relations ? relations.repackageOf : undefined) },
  },
  meta: ({ group }) => ({ editorialEntityId: group.editorialEntityId }),
});

const releaseContent = <V>(read: (entry: ReleaseEntry) => V) => content<ReleaseEntry>(({ release }) => release, read);

export const releaseSchema: ResourceSchema<ReleaseEntry> = defineResource({
  type: 'releases',
  id: ({ release }) => release.publicId,
  attributes: {
    publicationStatus: ({ release }) => release.editorialEntity!.publicationStatus,
    withdrawnAt: ({ release }) => release.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    title: releaseContent(({ release }) => release.title),
    // The release group's title is shown, never copied; a withdrawn group's is not shown at all.
    displayTitle: releaseContent(({ release, group }) => release.title ?? (isWithdrawn(group.group) ? null : group.group.title)),
    editionName: releaseContent(({ release }) => release.editionName),
    releaseDate: releaseContent(({ release }) => partialDate(release.releaseYear, release.releaseMonth, release.releaseDay)),
    releaseTime: releaseContent(({ release }) => release.releaseTime?.slice(0, 5) ?? null),
    timezone: releaseContent(({ release }) => release.timezone),
    releaseInstant: releaseContent(({ times }) => times.instant?.toISOString() ?? null),
    availability: releaseContent(({ times }) => times.availability),
    isCancelled: releaseContent(({ release }) => release.isCancelled),
    isExplicit: releaseContent(({ isExplicit }) => isExplicit),
    coverArt: releaseContent(({ coverArt }) => coverArt),
    createdAt: releaseContent(({ release }) => release.createdAt.toISOString()),
    updatedAt: releaseContent(({ release }) => release.updatedAt.toISOString()),
  },
  relationships: {
    releaseGroup: { schema: () => releaseGroupSchema, get: (entry) => (isWithdrawn(entry.release) ? undefined : entry.group) },
    tracks: { schema: () => trackSchema, get: ({ relations }) => relations?.tracks },
    contributions: { schema: () => releaseContributionSchema, get: ({ relations }) => relations?.contributions },
  },
  meta: ({ release }) => ({ editorialEntityId: release.editorialEntityId }),
});

// Swagger descriptions of the resource objects.

class ReleaseGroupAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ example: 'BE', required: false, description: WITHDRAWN })
  title?: string;

  @ApiProperty({ enum: RELEASE_GROUP_TYPES, required: false, description: `Como lo anunció su artista o agencia. ${WITHDRAWN}` })
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

class ReleaseGroupRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`release-artist-credits`, por `position`' })
  artistCredits: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`releases`: sus ediciones publicadas' })
  releases: ToManyLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`release-groups`: el lanzamiento original de un repackage, o null' })
  repackageOf: ToOneLinkage;
}

export class ReleaseGroupResource {
  @ApiProperty({ enum: ['release-groups'] })
  type: string;

  @ApiProperty({ description: 'public_id del lanzamiento' })
  id: string;

  @ApiProperty({ type: ReleaseGroupAttributes })
  attributes: ReleaseGroupAttributes;

  @ApiProperty({ type: ReleaseGroupRelationships, required: false, description: WITHDRAWN })
  relationships?: ReleaseGroupRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class ReleaseAttributes {
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
    enum: RELEASE_AVAILABILITIES,
    required: false,
    description: `Derivada: cancelada; próxima o publicada según su instante o el primer día de su fecha; desconocida sin fecha. ${WITHDRAWN}`,
  })
  availability?: string;

  @ApiProperty({ required: false, description: WITHDRAWN })
  isCancelled?: boolean;

  @ApiProperty({ required: false, description: `Derivado: alguna de sus pistas usa una grabación explícita. ${WITHDRAWN}` })
  isExplicit?: boolean;

  @ApiProperty({ type: ShownImageAttributes, nullable: true, required: false, description: `Portada. ${SHOWN_IMAGE_DESCRIPTION}. ${WITHDRAWN}` })
  coverArt?: ShownImageAttributes | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class ReleaseRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`release-groups`' })
  releaseGroup: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`tracks`, por disco y número' })
  tracks: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`release-contributions`, por `position`' })
  contributions: ToManyLinkage;
}

export class ReleaseResource {
  @ApiProperty({ enum: ['releases'] })
  type: string;

  @ApiProperty({ description: 'public_id de la edición' })
  id: string;

  @ApiProperty({ type: ReleaseAttributes })
  attributes: ReleaseAttributes;

  @ApiProperty({ type: ReleaseRelationships, required: false, description: WITHDRAWN })
  relationships?: ReleaseRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}
