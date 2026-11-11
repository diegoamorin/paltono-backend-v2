import { randomUUID } from 'node:crypto';
import { EntityManager, In, IsNull, Not } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { newPublicId } from '../catalog-identities/identity-creations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { PartialDateValue, partialDateColumns, partialDateValue } from '../common/partial-date/partial-date';
import { Edition } from './entities/edition.entity';
import { Release, ReleaseArtistCredit, ReleaseType } from './entities/release.entity';

/*
 * The writes of releases, their artist credits and editions. The editorial
 * flow calls them inside the transaction that applies a microchange, once it
 * holds the locks of every root involved. Another root is named by its
 * editorial UUID, as `{"entity_id": …}`, since its domain ids are not public.
 */

export interface RootReference {
  entity_id: string;
}

/** A release as its creation proposes it and its revisions record it. */
export interface ReleaseValue {
  title: string;
  type: ReleaseType;
  description?: string | null;
  repackageOf?: RootReference | null;
}

export const RELEASE_FIELDS = {
  'releases.title': 'title',
  'releases.type': 'type',
  'releases.description': 'description',
  'releases.repackage_of': 'repackageOf',
} as const;
export type ReleaseFieldPath = keyof typeof RELEASE_FIELDS;

/** When an edition comes out: a partial date and, with a complete one, the local time and its IANA zone. */
export interface ReleaseDateValue {
  releaseDate: PartialDateValue | null;
  releaseTime: string | null;
  timezone: string | null;
}

/** An edition as its creation proposes it and its revisions record it. */
export interface EditionValue extends Partial<ReleaseDateValue> {
  release: RootReference;
  title?: string | null;
  editionName?: string | null;
  coverArtUrl?: string | null;
  isCancelled?: boolean;
}

export const EDITION_FIELDS = {
  'editions.release': 'release',
  'editions.title': 'title',
  'editions.edition_name': 'editionName',
  'editions.release_date': 'releaseDate',
  'editions.cover_art_url': 'coverArtUrl',
  'editions.is_cancelled': 'isCancelled',
} as const;
export type EditionFieldPath = keyof typeof EDITION_FIELDS;

/** An artist credit of a release, keyed by the release and the artist. */
export interface ReleaseArtistCreditValue {
  position: number;
  creditedAs?: string | null;
}

// Releases

/** The internal id of the release of an editorial root, or null while it is only reserved. */
export async function releaseIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const release = await manager.findOne(Release, { select: { id: true }, where: { editorialEntityId: editorialEntityId.toLowerCase() } });
  return release?.id ?? null;
}

/** The editorial root of the release with the given public id, or null if there is none. */
export async function releaseRootOfPublicId(manager: EntityManager, publicId: string): Promise<string | null> {
  const release = await manager.findOne(Release, { select: { editorialEntityId: true }, where: { publicId } });
  return release?.editorialEntityId ?? null;
}

/** The public id of the release of each given editorial root, by root. */
export async function releasePublicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>> {
  const releases = await manager.find(Release, { select: { editorialEntityId: true, publicId: true }, where: { editorialEntityId: In(editorialEntityIds) } });
  return new Map(releases.map(({ editorialEntityId, publicId }) => [editorialEntityId, publicId]));
}

export async function findCreatedRelease(manager: EntityManager, editorialEntityId: string): Promise<{ release: Release; value: Required<ReleaseValue> } | null> {
  const release = await manager.findOneBy(Release, { editorialEntityId });
  if (!release) return null;
  const original = release.repackageOfId === null ? null : await manager.findOneByOrFail(Release, { id: release.repackageOfId });
  return {
    release,
    value: {
      title: release.title,
      type: release.type,
      description: release.description,
      repackageOf: original && { entity_id: original.editorialEntityId },
    },
  };
}

export async function createRelease(manager: EntityManager, editorialEntityId: string, value: ReleaseValue, now: Date): Promise<Release> {
  await manager.insert(Release, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    title: value.title,
    type: value.type,
    description: value.description ?? null,
    repackageOfId: await repackageOfId(manager, value.repackageOf ?? null),
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedRelease(manager, editorialEntityId))!.release;
}

export async function writeReleaseField(manager: EntityManager, editorialEntityId: string, path: ReleaseFieldPath, value: unknown, now: Date): Promise<unknown> {
  const field = RELEASE_FIELDS[path];
  const columns = field === 'repackageOf' ? { repackageOfId: await repackageOfId(manager, value as RootReference | null) } : { [field]: value };
  await manager.update(Release, { editorialEntityId }, { ...columns, updatedAt: now });
  return (await findCreatedRelease(manager, editorialEntityId))!.value[field];
}

/**
 * Whether linking a release to an original would close a cycle of
 * repackages: the original, or a release it relaunches in turn, is the
 * release itself. Serialized with every other repackage link by a transaction
 * lock, as two links applied at once may close a cycle neither sees alone.
 */
export async function closesRepackageCycle(manager: EntityManager, editorialEntityId: string, original: RootReference): Promise<boolean> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('releases.repackage_of'))`);
  const releaseId = await releaseIdOf(manager, editorialEntityId);
  const originalId = await releaseIdOf(manager, original.entity_id);
  if (releaseId === null || originalId === null) return false;
  const [{ cycle }] = await manager.query(
    `WITH RECURSIVE reached(id) AS (
       SELECT $1::integer
       UNION
       SELECT original.repackage_of_id FROM releases original JOIN reached ON original.id = reached.id
       WHERE original.repackage_of_id IS NOT NULL
     )
     SELECT EXISTS (SELECT 1 FROM reached WHERE id = $2) AS cycle`,
    [originalId, releaseId],
  );
  return cycle;
}

async function repackageOfId(manager: EntityManager, original: RootReference | null): Promise<number | null> {
  return original === null ? null : (await releaseIdOf(manager, original.entity_id))!;
}

// Artist credits

/** The internal id of the artist profile of an identity root, or null while it has none. */
export async function artistIdOfIdentity(manager: EntityManager, identityEntityId: string): Promise<number | null> {
  const identityId = await identityIdOf(manager, identityEntityId.toLowerCase());
  if (identityId === null) return null;
  const artist = await manager.findOne(Artist, { select: { id: true }, where: { catalogIdentityId: identityId } });
  return artist?.id ?? null;
}

export async function findReleaseArtistCredit(manager: EntityManager, releaseId: number, artistId: number): Promise<ReleaseArtistCreditValue | null> {
  const row = await manager.findOneBy(ReleaseArtistCredit, { releaseId, artistId });
  return row && { position: row.position, creditedAs: row.creditedAs };
}

export async function writeReleaseArtistCredit(
  manager: EntityManager,
  releaseId: number,
  artistId: number,
  value: ReleaseArtistCreditValue,
  now: Date,
): Promise<void> {
  const columns = { position: value.position, creditedAs: value.creditedAs ?? null };
  if (await manager.existsBy(ReleaseArtistCredit, { releaseId, artistId })) {
    await manager.update(ReleaseArtistCredit, { releaseId, artistId }, { ...columns, updatedAt: now });
  } else {
    await manager.insert(ReleaseArtistCredit, { releaseId, artistId, ...columns, createdAt: now, updatedAt: now });
  }
  await manager.update(Release, { id: releaseId }, { updatedAt: now });
}

export async function deleteReleaseArtistCredit(manager: EntityManager, releaseId: number, artistId: number, now: Date): Promise<void> {
  await manager.delete(ReleaseArtistCredit, { releaseId, artistId });
  await manager.update(Release, { id: releaseId }, { updatedAt: now });
}

// Editions

/** The internal id of the edition of an editorial root, or null while it is only reserved. */
export async function editionIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const edition = await manager.findOne(Edition, { select: { id: true }, where: { editorialEntityId } });
  return edition?.id ?? null;
}

/** The editorial root of the edition with the given public id, or null if there is none. */
export async function editionRootOfPublicId(manager: EntityManager, publicId: string): Promise<string | null> {
  const edition = await manager.findOne(Edition, { select: { editorialEntityId: true }, where: { publicId } });
  return edition?.editorialEntityId ?? null;
}

/** The public id of the edition of each given editorial root, by root. */
export async function editionPublicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>> {
  const editions = await manager.find(Edition, { select: { editorialEntityId: true, publicId: true }, where: { editorialEntityId: In(editorialEntityIds) } });
  return new Map(editions.map(({ editorialEntityId, publicId }) => [editorialEntityId, publicId]));
}

export async function findCreatedEdition(manager: EntityManager, editorialEntityId: string): Promise<{ edition: Edition; value: Required<EditionValue> } | null> {
  const edition = await manager.findOneBy(Edition, { editorialEntityId });
  if (!edition) return null;
  const release = await manager.findOneByOrFail(Release, { id: edition.releaseId });
  return {
    edition,
    value: {
      release: { entity_id: release.editorialEntityId },
      title: edition.title,
      editionName: edition.editionName,
      releaseDate: partialDateValue(edition, 'release'),
      // Stored with seconds; proposed and shown as HH:MM.
      releaseTime: edition.releaseTime?.slice(0, 5) ?? null,
      timezone: edition.timezone,
      coverArtUrl: edition.coverArtUrl,
      isCancelled: edition.isCancelled,
    },
  };
}

/** The value of one field of an edition, as its field change proposes it. */
export function editionFieldValue(value: Required<EditionValue>, path: EditionFieldPath): unknown {
  if (path === 'editions.release_date') return { releaseDate: value.releaseDate, releaseTime: value.releaseTime, timezone: value.timezone };
  return value[EDITION_FIELDS[path]];
}

export async function createEdition(manager: EntityManager, editorialEntityId: string, value: EditionValue, now: Date): Promise<Edition> {
  await manager.insert(Edition, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    releaseId: (await releaseIdOf(manager, value.release.entity_id))!,
    title: value.title ?? null,
    editionName: value.editionName ?? null,
    ...dateColumns({ releaseDate: value.releaseDate ?? null, releaseTime: value.releaseTime ?? null, timezone: value.timezone ?? null }),
    coverArtUrl: value.coverArtUrl ?? null,
    isCancelled: value.isCancelled ?? false,
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedEdition(manager, editorialEntityId))!.edition;
}

export async function writeEditionField(manager: EntityManager, editorialEntityId: string, path: EditionFieldPath, value: unknown, now: Date): Promise<unknown> {
  let columns: object;
  if (path === 'editions.release_date') columns = dateColumns(value as ReleaseDateValue);
  else if (path === 'editions.release') columns = { releaseId: (await releaseIdOf(manager, (value as RootReference).entity_id))! };
  else columns = { [EDITION_FIELDS[path]]: value };
  await manager.update(Edition, { editorialEntityId }, { ...columns, updatedAt: now });
  return editionFieldValue((await findCreatedEdition(manager, editorialEntityId))!.value, path);
}

/**
 * What an edition in a release under an edition name would break, besides
 * the edition itself: at most one edition per release and edition name, so at
 * most one unnamed, standard edition. Empty while the release is not created
 * yet.
 */
export async function editionNameClashes(
  manager: EntityManager,
  release: RootReference,
  editionName: string | null,
  editorialEntityId: string,
): Promise<string[]> {
  const releaseId = await releaseIdOf(manager, release.entity_id);
  if (releaseId === null) return [];
  const taken = await manager.existsBy(Edition, {
    releaseId,
    editionName: editionName === null ? IsNull() : editionName,
    editorialEntityId: Not(editorialEntityId),
  });
  if (!taken) return [];
  return [editionName === null ? 'El lanzamiento ya tiene una edición sin nombre' : `El lanzamiento ya tiene una edición «${editionName}»`];
}

function dateColumns({ releaseDate, releaseTime, timezone }: ReleaseDateValue) {
  return {
    ...partialDateColumns('release', releaseDate),
    releaseTime,
    timezone,
  };
}
