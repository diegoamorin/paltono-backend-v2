import { randomUUID } from 'node:crypto';
import { EntityManager, In, IsNull, Not } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { newPublicId } from '../catalog-identities/identity-creations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { PartialDateValue, partialDateColumns, partialDateValue } from '../common/partial-date/partial-date';
import { Edition } from './entities/edition.entity';
import { Release, ReleaseArtistCredit, ReleaseType } from './entities/release.entity';

/*
 * The writes of release groups, their artist credits and releases. The
 * editorial flow calls them inside the transaction that applies a microchange,
 * once it holds the locks of every root involved. Another root is named by its
 * editorial UUID, as `{"entity_id": …}`, since its domain ids are not public.
 */

export interface RootReference {
  entity_id: string;
}

/** A release group as its creation proposes it and its revisions record it. */
export interface ReleaseGroupValue {
  title: string;
  type: ReleaseType;
  description?: string | null;
  repackageOf?: RootReference | null;
}

export const RELEASE_GROUP_FIELDS = {
  'release_groups.title': 'title',
  'release_groups.type': 'type',
  'release_groups.description': 'description',
  'release_groups.repackage_of': 'repackageOf',
} as const;
export type ReleaseGroupFieldPath = keyof typeof RELEASE_GROUP_FIELDS;

/** When a release comes out: a partial date and, with a complete one, the local time and its IANA zone. */
export interface ReleaseDateValue {
  releaseDate: PartialDateValue | null;
  releaseTime: string | null;
  timezone: string | null;
}

/** A release as its creation proposes it and its revisions record it. */
export interface ReleaseValue extends Partial<ReleaseDateValue> {
  releaseGroup: RootReference;
  title?: string | null;
  editionName?: string | null;
  coverArtUrl?: string | null;
  isCancelled?: boolean;
}

export const RELEASE_FIELDS = {
  'releases.release_group': 'releaseGroup',
  'releases.title': 'title',
  'releases.edition_name': 'editionName',
  'releases.release_date': 'releaseDate',
  'releases.cover_art_url': 'coverArtUrl',
  'releases.is_cancelled': 'isCancelled',
} as const;
export type ReleaseFieldPath = keyof typeof RELEASE_FIELDS;

/** An artist credit of a release group, keyed by the group and the artist. */
export interface ReleaseArtistCreditValue {
  position: number;
  creditedAs?: string | null;
}

// Release groups

/** The internal id of the release group of an editorial root, or null while it is only reserved. */
export async function releaseGroupIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const group = await manager.findOne(Release, { select: { id: true }, where: { editorialEntityId: editorialEntityId.toLowerCase() } });
  return group?.id ?? null;
}

/** The editorial root of the release group with the given public id, or null if there is none. */
export async function releaseGroupRootOfPublicId(manager: EntityManager, publicId: string): Promise<string | null> {
  const group = await manager.findOne(Release, { select: { editorialEntityId: true }, where: { publicId } });
  return group?.editorialEntityId ?? null;
}

/** The public id of the release group of each given editorial root, by root. */
export async function releaseGroupPublicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>> {
  const groups = await manager.find(Release, { select: { editorialEntityId: true, publicId: true }, where: { editorialEntityId: In(editorialEntityIds) } });
  return new Map(groups.map(({ editorialEntityId, publicId }) => [editorialEntityId, publicId]));
}

export async function findCreatedReleaseGroup(
  manager: EntityManager,
  editorialEntityId: string,
): Promise<{ group: Release; value: Required<ReleaseGroupValue> } | null> {
  const group = await manager.findOneBy(Release, { editorialEntityId });
  if (!group) return null;
  const original = group.repackageOfId === null ? null : await manager.findOneByOrFail(Release, { id: group.repackageOfId });
  return {
    group,
    value: {
      title: group.title,
      type: group.type,
      description: group.description,
      repackageOf: original && { entity_id: original.editorialEntityId },
    },
  };
}

export async function createReleaseGroup(manager: EntityManager, editorialEntityId: string, value: ReleaseGroupValue, now: Date): Promise<Release> {
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
  return (await findCreatedReleaseGroup(manager, editorialEntityId))!.group;
}

export async function writeReleaseGroupField(
  manager: EntityManager,
  editorialEntityId: string,
  path: ReleaseGroupFieldPath,
  value: unknown,
  now: Date,
): Promise<unknown> {
  const field = RELEASE_GROUP_FIELDS[path];
  const columns = field === 'repackageOf' ? { repackageOfId: await repackageOfId(manager, value as RootReference | null) } : { [field]: value };
  await manager.update(Release, { editorialEntityId }, { ...columns, updatedAt: now });
  return (await findCreatedReleaseGroup(manager, editorialEntityId))!.value[field];
}

/**
 * Whether linking a release group to an original would close a cycle of
 * repackages: the original, or a group it relaunches in turn, is the group
 * itself. Serialized with every other repackage link by a transaction lock, as
 * two links applied at once may close a cycle neither sees alone.
 */
export async function closesRepackageCycle(manager: EntityManager, editorialEntityId: string, original: RootReference): Promise<boolean> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('releases.repackage_of'))`);
  const groupId = await releaseGroupIdOf(manager, editorialEntityId);
  const originalId = await releaseGroupIdOf(manager, original.entity_id);
  if (groupId === null || originalId === null) return false;
  const [{ cycle }] = await manager.query(
    `WITH RECURSIVE reached(id) AS (
       SELECT $1::integer
       UNION
       SELECT original.repackage_of_id FROM releases original JOIN reached ON original.id = reached.id
       WHERE original.repackage_of_id IS NOT NULL
     )
     SELECT EXISTS (SELECT 1 FROM reached WHERE id = $2) AS cycle`,
    [originalId, groupId],
  );
  return cycle;
}

async function repackageOfId(manager: EntityManager, original: RootReference | null): Promise<number | null> {
  return original === null ? null : (await releaseGroupIdOf(manager, original.entity_id))!;
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

// Releases

/** The internal id of the release of an editorial root, or null while it is only reserved. */
export async function releaseIdOf(manager: EntityManager, editorialEntityId: string): Promise<number | null> {
  const release = await manager.findOne(Edition, { select: { id: true }, where: { editorialEntityId } });
  return release?.id ?? null;
}

/** The editorial root of the release with the given public id, or null if there is none. */
export async function releaseRootOfPublicId(manager: EntityManager, publicId: string): Promise<string | null> {
  const release = await manager.findOne(Edition, { select: { editorialEntityId: true }, where: { publicId } });
  return release?.editorialEntityId ?? null;
}

/** The public id of the release of each given editorial root, by root. */
export async function releasePublicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>> {
  const releases = await manager.find(Edition, { select: { editorialEntityId: true, publicId: true }, where: { editorialEntityId: In(editorialEntityIds) } });
  return new Map(releases.map(({ editorialEntityId, publicId }) => [editorialEntityId, publicId]));
}

export async function findCreatedRelease(manager: EntityManager, editorialEntityId: string): Promise<{ release: Edition; value: Required<ReleaseValue> } | null> {
  const release = await manager.findOneBy(Edition, { editorialEntityId });
  if (!release) return null;
  const group = await manager.findOneByOrFail(Release, { id: release.releaseId });
  return {
    release,
    value: {
      releaseGroup: { entity_id: group.editorialEntityId },
      title: release.title,
      editionName: release.editionName,
      releaseDate: partialDateValue(release, 'release'),
      // Stored with seconds; proposed and shown as HH:MM.
      releaseTime: release.releaseTime?.slice(0, 5) ?? null,
      timezone: release.timezone,
      coverArtUrl: release.coverArtUrl,
      isCancelled: release.isCancelled,
    },
  };
}

/** The value of one field of a release, as its field change proposes it. */
export function releaseFieldValue(value: Required<ReleaseValue>, path: ReleaseFieldPath): unknown {
  if (path === 'releases.release_date') return { releaseDate: value.releaseDate, releaseTime: value.releaseTime, timezone: value.timezone };
  return value[RELEASE_FIELDS[path]];
}

export async function createRelease(manager: EntityManager, editorialEntityId: string, value: ReleaseValue, now: Date): Promise<Edition> {
  await manager.insert(Edition, {
    uuid: randomUUID(),
    publicId: newPublicId(),
    releaseId: (await releaseGroupIdOf(manager, value.releaseGroup.entity_id))!,
    title: value.title ?? null,
    editionName: value.editionName ?? null,
    ...dateColumns({ releaseDate: value.releaseDate ?? null, releaseTime: value.releaseTime ?? null, timezone: value.timezone ?? null }),
    coverArtUrl: value.coverArtUrl ?? null,
    isCancelled: value.isCancelled ?? false,
    createdAt: now,
    updatedAt: now,
    editorialEntityId,
  });
  return (await findCreatedRelease(manager, editorialEntityId))!.release;
}

export async function writeReleaseField(manager: EntityManager, editorialEntityId: string, path: ReleaseFieldPath, value: unknown, now: Date): Promise<unknown> {
  let columns: object;
  if (path === 'releases.release_date') columns = dateColumns(value as ReleaseDateValue);
  else if (path === 'releases.release_group') columns = { releaseId: (await releaseGroupIdOf(manager, (value as RootReference).entity_id))! };
  else columns = { [RELEASE_FIELDS[path]]: value };
  await manager.update(Edition, { editorialEntityId }, { ...columns, updatedAt: now });
  return releaseFieldValue((await findCreatedRelease(manager, editorialEntityId))!.value, path);
}

/**
 * What a release in a group under an edition name would break, besides the
 * release itself: at most one release per group and edition name, so at most
 * one unnamed, standard release. Null while the group is not created yet.
 */
export async function editionNameClashes(
  manager: EntityManager,
  group: RootReference,
  editionName: string | null,
  editorialEntityId: string,
): Promise<string[]> {
  const releaseId = await releaseGroupIdOf(manager, group.entity_id);
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
