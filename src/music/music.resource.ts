import { ApiProperty } from '@nestjs/swagger';
import { IdentityEntry, identitySchema } from '../catalog-identities/identity.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { CONTRIBUTION_ROLES } from '../vocabularies/contribution-roles';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Genre } from '../vocabularies/entities/genre.entity';
import { GENRES } from '../vocabularies/genres';
import { RECORDING_WORK_RELATION_TYPES, Recording, RecordingWork } from './entities/recording.entity';
import { Credit, Work } from './entities/work.entity';
import type { ReleaseEntry } from './release.resource';
import { TrackEntry, trackSchema } from './track.resource';

/*
 * The public resources of works and recordings. An entry reached as the
 * target of a relationship carries no relations of its own (`undefined`); a
 * withdrawn entry carries none either (`null`) and shows only its notice.
 */

export interface WorkEntry {
  /** With its editorial root. */
  work: Work;
  relations?: { contributions: CreditEntry[]; recordingWorks: RecordingWorkEntry[] } | null;
}

export interface RecordingEntry {
  /** With its editorial root. */
  recording: Recording;
  relations?: {
    contributions: CreditEntry[];
    /** The primary genre first. */
    genres: Genre[];
    primaryGenreId: number | null;
    recordingWorks: RecordingWorkEntry[];
    /** Its appearances in published releases, without credits nor links. */
    tracks: TrackEntry[];
  } | null;
}

export type CreditScope = 'work' | 'recording' | 'release';

export interface CreditEntry {
  scope: CreditScope;
  credit: Credit;
  identity: IdentityEntry;
  /** With its scopes. */
  role: ContributionRole;
  /** The credited work or recording, loaded where the credit is the primary data. */
  work?: WorkEntry;
  recording?: RecordingEntry;
  release?: ReleaseEntry;
}

export interface RecordingWorkEntry {
  row: RecordingWork;
  work: WorkEntry;
  recording: RecordingEntry;
}

const isWithdrawn = (root: { editorialEntity?: { publicationStatus: string } }) => root.editorialEntity!.publicationStatus === 'withdrawn';

/** An attribute of an entry's content, which a withdrawn entry leaves out: it only shows the notice. */
const content =
  <T>(root: (entry: T) => Work | Recording, read: (entry: T) => unknown) =>
  (entry: T): unknown =>
    isWithdrawn(root(entry)) ? undefined : read(entry);

const partialDate = (year: number | null, month: number | null, day: number | null) => (year === null ? null : { year, month, day });

export const creditAttributes = {
  creditedAs: ({ credit }: CreditEntry) => credit.creditedAs,
  position: ({ credit }: CreditEntry) => credit.position,
  details: ({ credit }: CreditEntry) => credit.details,
  sourceText: ({ credit }: CreditEntry) => credit.sourceText,
  sourceUrl: ({ credit }: CreditEntry) => credit.sourceUrl,
};

export const creditRelationships = {
  identity: { schema: () => identitySchema, get: ({ identity }: CreditEntry) => identity },
  role: { schema: () => CONTRIBUTION_ROLES.schema, get: ({ role }: CreditEntry) => role },
};

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
    createdAt: workContent(({ work }) => work.createdAt.toISOString()),
    updatedAt: workContent(({ work }) => work.updatedAt.toISOString()),
  },
  relationships: {
    contributions: { schema: () => workContributionSchema, get: ({ relations }) => relations?.contributions },
    recordingWorks: { schema: () => recordingWorkSchema, get: ({ relations }) => relations?.recordingWorks },
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
    recordingDate: recordingContent(({ recording }) => partialDate(recording.recordingYear, recording.recordingMonth, recording.recordingDay)),
    primaryGenreId: recordingContent(({ relations }) => (relations ? (relations.primaryGenreId === null ? null : String(relations.primaryGenreId)) : undefined)),
    createdAt: recordingContent(({ recording }) => recording.createdAt.toISOString()),
    updatedAt: recordingContent(({ recording }) => recording.updatedAt.toISOString()),
  },
  relationships: {
    contributions: { schema: () => recordingContributionSchema, get: ({ relations }) => relations?.contributions },
    genres: { schema: () => GENRES.schema, get: ({ relations }) => relations?.genres },
    recordingWorks: { schema: () => recordingWorkSchema, get: ({ relations }) => relations?.recordingWorks },
    tracks: { schema: () => trackSchema, get: ({ relations }) => relations?.tracks },
  },
  meta: ({ recording }) => ({ editorialEntityId: recording.editorialEntityId }),
});

// Swagger descriptions of the resource objects.

export const WITHDRAWN = 'Ausente en una ficha retirada';

export class PartialDate {
  @ApiProperty({ example: 2021 })
  year: number;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  day: number | null;
}

export class EntryMeta {
  @ApiProperty({ format: 'uuid', description: 'UUID editorial con el que se proponen cambios a la ficha' })
  editorialEntityId: string;
}

export class ToOneLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

export class ToManyLinkage {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}

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

  @ApiProperty({ type: String, nullable: true, required: false, description: `id del género primario, entre \`genres\`. ${WITHDRAWN}` })
  primaryGenreId?: string | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class RecordingRelationships {
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
