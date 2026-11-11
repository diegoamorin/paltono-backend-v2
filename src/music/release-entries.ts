import { EntityManager, In } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { shownImages } from '../images/shown-images';
import { Edition } from './entities/edition.entity';
import { Release, ReleaseArtistCredit } from './entities/release.entity';
import { EditionContribution, Track } from './entities/track.entity';
import { creditEntries } from './music-entries';
import { trackEntries } from './track-entries';
import { editionTimes, releaseDates } from './release-dates';
import { EditionEntry, ReleaseArtistCreditEntry, ReleaseEntry } from './release.resource';

/*
 * Loads releases and editions as entries with their derived dates and, for
 * the primary data, their relations. The targets of those relations are
 * entries without relations of their own, as an include reaches at most two
 * levels.
 */

const notWithdrawn = (root: Release | Edition) => root.editorialEntity!.publicationStatus !== 'withdrawn';

/** Releases, each with its editorial root loaded, as entries; with their relations when `withRelations`. */
export async function releaseEntries(manager: EntityManager, releases: Release[], now: Date, withRelations = true): Promise<ReleaseEntry[]> {
  const dates = await releaseDates(manager, releases.map(({ id }) => id), now);
  const plain = releases.map((release) => ({ release, dates: dates.get(release.id)! }));
  if (!withRelations) return plain;

  const ids = releases.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const credited = await withReleaseArtistCredits(manager, plain);
  const editions = await manager
    .createQueryBuilder(Edition, 'edition')
    .innerJoinAndSelect('edition.editorialEntity', 'root')
    .where('edition.release_id IN (:...ids)', { ids })
    .andWhere(`root.publication_status = 'published'`)
    .orderBy('edition.release_year', 'ASC', 'NULLS LAST')
    .addOrderBy('edition.release_month', 'ASC', 'NULLS FIRST')
    .addOrderBy('edition.release_day', 'ASC', 'NULLS FIRST')
    .addOrderBy('edition.id', 'ASC')
    .getMany();
  const editionList = await editionEntries(manager, editions, now, false);
  const originalIds = [...new Set(releases.flatMap(({ repackageOfId }) => (repackageOfId === null ? [] : [repackageOfId])))];
  const originals = await releaseEntries(
    manager,
    originalIds.length === 0 ? [] : await manager.find(Release, { where: { id: In(originalIds) }, relations: { editorialEntity: true } }),
    now,
    false,
  );

  return credited.map((entry) => {
    const { release } = entry;
    if (!ids.includes(release.id)) return { ...entry, relations: null };
    return {
      ...entry,
      relations: {
        editions: editionList.filter(({ edition }) => edition.releaseId === release.id),
        repackageOf: originals.find(({ release: original }) => original.id === release.repackageOfId) ?? null,
      },
    };
  });
}

/** Release entries with their artist credit, which a withdrawn release does not show. */
export async function withReleaseArtistCredits(manager: EntityManager, entries: ReleaseEntry[]): Promise<ReleaseEntry[]> {
  const ids = entries.map(({ release }) => release).filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return entries;
  const credits = await artistCreditEntries(manager, await manager.find(ReleaseArtistCredit, { where: { releaseId: In(ids) }, order: { position: 'ASC', artistId: 'ASC' } }));
  return entries.map((entry) =>
    ids.includes(entry.release.id) ? { ...entry, artistCredits: credits.filter(({ credit }) => credit.releaseId === entry.release.id) } : entry,
  );
}

/** Editions, each with its editorial root loaded, as entries with their release; with their relations when `withRelations`. */
export async function editionEntries(manager: EntityManager, editions: Edition[], now: Date, withRelations = true): Promise<EditionEntry[]> {
  if (editions.length === 0) return [];
  const times = await editionTimes(manager, editions.map(({ id }) => id), now);
  const releaseIds = [...new Set(editions.map(({ releaseId }) => releaseId))];
  const releases = await releaseEntries(manager, await manager.find(Release, { where: { id: In(releaseIds) }, relations: { editorialEntity: true } }), now, false);
  const explicit = await explicitEditionIds(manager, editions.map(({ id }) => id));
  const images = await shownImages(manager, editions.filter(notWithdrawn).map(({ coverArtUrl }) => coverArtUrl));
  const plain = editions.map((edition) => ({
    edition,
    times: times.get(edition.id)!,
    isExplicit: explicit.has(edition.id),
    release: releases.find(({ release }) => release.id === edition.releaseId)!,
    coverArt: images(edition.coverArtUrl),
  }));
  if (!withRelations) return plain;

  const ids = editions.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const contributions = await creditEntries(
    manager,
    'edition',
    await manager.find(EditionContribution, { where: { editionId: In(ids) }, order: { position: 'ASC', id: 'ASC' } }),
  );
  const tracks = await trackEntries(
    manager,
    await manager.find(Track, { where: { editionId: In(ids) }, order: { discNumber: 'ASC', trackNumber: 'ASC' } }),
    now,
    false,
  );
  return plain.map((entry) => {
    const { edition } = entry;
    if (!ids.includes(edition.id)) return { ...entry, relations: null };
    return {
      ...entry,
      relations: {
        contributions: contributions.filter(({ credit }) => (credit as EditionContribution).editionId === edition.id),
        tracks: tracks.filter(({ track }) => track.editionId === edition.id),
      },
    };
  });
}

/**
 * The editions whose content is explicit: some track uses an explicit
 * recording. Derived on each read; a withdrawn recording shows nothing of its
 * content, so it does not count.
 */
async function explicitEditionIds(manager: EntityManager, editionIds: number[]): Promise<Set<number>> {
  const rows: { editionId: number }[] = await manager.query(
    `SELECT DISTINCT track.edition_id AS "editionId"
     FROM tracks track
     JOIN recordings recording ON recording.id = track.recording_id
     JOIN editorial_entities root ON root.id = recording.editorial_entity_id
     WHERE track.edition_id = ANY($1) AND recording.is_explicit AND root.publication_status = 'published'`,
    [editionIds],
  );
  return new Set(rows.map(({ editionId }) => editionId));
}

/** Artist credits with their artists and identities, in the given order. */
async function artistCreditEntries(manager: EntityManager, credits: ReleaseArtistCredit[]): Promise<ReleaseArtistCreditEntry[]> {
  if (credits.length === 0) return [];
  const artists = await manager.find(Artist, { where: { id: In([...new Set(credits.map(({ artistId }) => artistId))]) } });
  const identities = await identityEntriesById(manager, artists.map(({ catalogIdentityId }) => catalogIdentityId));
  const releases = await manager.find(Release, { where: { id: In([...new Set(credits.map(({ releaseId }) => releaseId))]) } });
  return credits.map((credit) => {
    const artist = artists.find(({ id }) => id === credit.artistId)!;
    return {
      credit,
      release: releases.find(({ id }) => id === credit.releaseId)!,
      artist: { artist, identity: identities.get(artist.catalogIdentityId)! },
    };
  });
}
