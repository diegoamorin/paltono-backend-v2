import { EntityManager, In } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { shownImages } from '../images/shown-images';
import { Release, ReleaseArtistCredit, ReleaseGroup } from './entities/release.entity';
import { ReleaseContribution, Track } from './entities/track.entity';
import { creditEntries } from './music-entries';
import { trackEntries } from './track-entries';
import { releaseGroupDates, releaseTimes } from './release-dates';
import { ReleaseArtistCreditEntry, ReleaseEntry, ReleaseGroupEntry } from './release.resource';

/*
 * Loads release groups and releases as entries with their derived dates and,
 * for the primary data, their relations. The targets of those relations are
 * entries without relations of their own, as an include reaches at most two
 * levels.
 */

const notWithdrawn = (root: ReleaseGroup | Release) => root.editorialEntity!.publicationStatus !== 'withdrawn';

/** Release groups, each with its editorial root loaded, as entries; with their relations when `withRelations`. */
export async function releaseGroupEntries(manager: EntityManager, groups: ReleaseGroup[], now: Date, withRelations = true): Promise<ReleaseGroupEntry[]> {
  const dates = await releaseGroupDates(manager, groups.map(({ id }) => id), now);
  const plain = groups.map((group) => ({ group, dates: dates.get(group.id)! }));
  if (!withRelations) return plain;

  const ids = groups.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const credits = await artistCreditEntries(manager, await manager.find(ReleaseArtistCredit, { where: { releaseGroupId: In(ids) }, order: { position: 'ASC', artistId: 'ASC' } }));
  const releases = await manager
    .createQueryBuilder(Release, 'release')
    .innerJoinAndSelect('release.editorialEntity', 'root')
    .where('release.release_group_id IN (:...ids)', { ids })
    .andWhere(`root.publication_status = 'published'`)
    .orderBy('release.release_year', 'ASC', 'NULLS LAST')
    .addOrderBy('release.release_month', 'ASC', 'NULLS FIRST')
    .addOrderBy('release.release_day', 'ASC', 'NULLS FIRST')
    .addOrderBy('release.id', 'ASC')
    .getMany();
  const releaseList = await releaseEntries(manager, releases, now, false);
  const originalIds = [...new Set(groups.flatMap(({ repackageOfId }) => (repackageOfId === null ? [] : [repackageOfId])))];
  const originals = await releaseGroupEntries(
    manager,
    originalIds.length === 0 ? [] : await manager.find(ReleaseGroup, { where: { id: In(originalIds) }, relations: { editorialEntity: true } }),
    now,
    false,
  );

  return plain.map((entry) => {
    const { group } = entry;
    if (!ids.includes(group.id)) return { ...entry, relations: null };
    return {
      ...entry,
      relations: {
        artistCredits: credits.filter(({ credit }) => credit.releaseGroupId === group.id),
        releases: releaseList.filter(({ release }) => release.releaseGroupId === group.id),
        repackageOf: originals.find(({ group: original }) => original.id === group.repackageOfId) ?? null,
      },
    };
  });
}

/** Releases, each with its editorial root loaded, as entries with their group; with their relations when `withRelations`. */
export async function releaseEntries(manager: EntityManager, releases: Release[], now: Date, withRelations = true): Promise<ReleaseEntry[]> {
  if (releases.length === 0) return [];
  const times = await releaseTimes(manager, releases.map(({ id }) => id), now);
  const groupIds = [...new Set(releases.map(({ releaseGroupId }) => releaseGroupId))];
  const groups = await releaseGroupEntries(manager, await manager.find(ReleaseGroup, { where: { id: In(groupIds) }, relations: { editorialEntity: true } }), now, false);
  const explicit = await explicitReleaseIds(manager, releases.map(({ id }) => id));
  const images = await shownImages(manager, releases.filter(notWithdrawn).map(({ coverArtUrl }) => coverArtUrl));
  const plain = releases.map((release) => ({
    release,
    times: times.get(release.id)!,
    isExplicit: explicit.has(release.id),
    group: groups.find(({ group }) => group.id === release.releaseGroupId)!,
    coverArt: images(release.coverArtUrl),
  }));
  if (!withRelations) return plain;

  const ids = releases.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const contributions = await creditEntries(
    manager,
    'release',
    await manager.find(ReleaseContribution, { where: { releaseId: In(ids) }, order: { position: 'ASC', id: 'ASC' } }),
  );
  const tracks = await trackEntries(
    manager,
    await manager.find(Track, { where: { releaseId: In(ids) }, order: { discNumber: 'ASC', trackNumber: 'ASC' } }),
    now,
    false,
  );
  return plain.map((entry) => {
    const { release } = entry;
    if (!ids.includes(release.id)) return { ...entry, relations: null };
    return {
      ...entry,
      relations: {
        contributions: contributions.filter(({ credit }) => (credit as ReleaseContribution).releaseId === release.id),
        tracks: tracks.filter(({ track }) => track.releaseId === release.id),
      },
    };
  });
}

/**
 * The releases whose content is explicit: some track uses an explicit
 * recording. Derived on each read; a withdrawn recording shows nothing of its
 * content, so it does not count.
 */
async function explicitReleaseIds(manager: EntityManager, releaseIds: number[]): Promise<Set<number>> {
  const rows: { releaseId: number }[] = await manager.query(
    `SELECT DISTINCT track.release_id AS "releaseId"
     FROM tracks track
     JOIN recordings recording ON recording.id = track.recording_id
     JOIN editorial_entities root ON root.id = recording.editorial_entity_id
     WHERE track.release_id = ANY($1) AND recording.is_explicit AND root.publication_status = 'published'`,
    [releaseIds],
  );
  return new Set(rows.map(({ releaseId }) => releaseId));
}

/** Presentation credits with their artists and identities, in the given order. */
async function artistCreditEntries(manager: EntityManager, credits: ReleaseArtistCredit[]): Promise<ReleaseArtistCreditEntry[]> {
  if (credits.length === 0) return [];
  const artists = await manager.find(Artist, { where: { id: In([...new Set(credits.map(({ artistId }) => artistId))]) } });
  const identities = await identityEntriesById(manager, artists.map(({ catalogIdentityId }) => catalogIdentityId));
  const groups = await manager.find(ReleaseGroup, { where: { id: In([...new Set(credits.map(({ releaseGroupId }) => releaseGroupId))]) } });
  return credits.map((credit) => {
    const artist = artists.find(({ id }) => id === credit.artistId)!;
    return {
      credit,
      group: groups.find(({ id }) => id === credit.releaseGroupId)!,
      artist: { artist, identity: identities.get(artist.catalogIdentityId)! },
    };
  });
}
