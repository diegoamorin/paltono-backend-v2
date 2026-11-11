import { EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { EditorialEntity } from '../editorial/entities/editorial-entity.entity';
import { Edition } from './entities/edition.entity';
import { Track } from './entities/track.entity';
import { trackEntries } from './track-entries';
import { recordingArtistCreditEntries } from './artist-credit-entries';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Recording, RecordingContribution, RecordingGenre, RecordingWork } from './entities/recording.entity';
import { withPlatformLinks } from './platform-link-entries';
import { Credit, Work, WorkContribution } from './entities/work.entity';
import { FirstRecordingEntry, RecordingEntry, RecordingWorkEntry, WorkEntry } from './music.resource';
import { CreditEntry, CreditScope } from './resource-primitives';
import { performancesSql, recordingReleaseDates, recordingReleaseSql } from './release-dates';

/*
 * Loads works and recordings as entries with their relations. The targets of
 * those relations are entries without relations of their own, as an include
 * reaches at most two levels.
 */

const notWithdrawn = (root: Work | Recording) => root.editorialEntity!.publicationStatus !== 'withdrawn';

/** Works, each with its editorial root loaded, as entries without relations but with their first recording. */
export async function plainWorkEntries(manager: EntityManager, works: Work[]): Promise<WorkEntry[]> {
  const firsts = await firstRecordings(manager, works.filter(notWithdrawn).map(({ id }) => id));
  return works.map((work) => ({ work, firstRecording: firsts.get(work.id) ?? null }));
}

/**
 * The first recording of each work, by id: of the published recordings that
 * perform it, the one with the earliest release date; those without one go
 * after, and a tie goes to the lower public id.
 */
async function firstRecordings(manager: EntityManager, workIds: string[]): Promise<Map<string, FirstRecordingEntry>> {
  if (workIds.length === 0) return new Map();
  const rows: { workId: string; recordingId: number }[] = await manager.query(
    `SELECT DISTINCT ON (recording_link.work_id) recording_link.work_id AS "workId", recording.id AS "recordingId"
      ${performancesSql('recording', 'ANY($1)')}
      ORDER BY recording_link.work_id, ${recordingReleaseSql('recording').start} NULLS LAST, recording.public_id`,
    [workIds],
  );
  if (rows.length === 0) return new Map();
  const recordings = await manager.find(Recording, { where: { id: In(rows.map(({ recordingId }) => recordingId)) }, relations: { editorialEntity: true } });
  const entries = await plainRecordingEntries(manager, recordings);
  const credits = await recordingArtistCreditEntries(manager, recordings);
  return new Map(
    rows.map(({ workId, recordingId }) => [
      String(workId),
      { recording: entries.find(({ recording }) => recording.id === recordingId)!, artistCredits: credits.filter(({ credit }) => credit.recordingId === recordingId) },
    ]),
  );
}

export async function workEntries(manager: EntityManager, works: Work[]): Promise<WorkEntry[]> {
  const plain = await plainWorkEntries(manager, works);
  const ids = works.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const credits = await manager.find(WorkContribution, { where: { workId: In(ids) }, order: { position: 'ASC', id: 'ASC' } });
  const contributions = await creditEntries(manager, 'work', credits);
  const recordingWorks = await recordingWorkEntries(
    manager,
    await manager.find(RecordingWork, { where: { workId: In(ids) }, order: { recordingId: 'ASC', position: 'ASC', id: 'ASC' } }),
  );
  return plain.map(({ work, ...entry }) => ({
    work,
    ...entry,
    relations: ids.includes(work.id)
      ? {
          contributions: contributions.filter(({ credit }) => (credit as WorkContribution).workId === work.id),
          recordingWorks: recordingWorks.filter(({ row }) => row.workId === work.id),
        }
      : null,
  }));
}

/** Recordings, each with its editorial root loaded, as entries without relations. */
export async function plainRecordingEntries(manager: EntityManager, recordings: Recording[]): Promise<RecordingEntry[]> {
  const dates = await recordingReleaseDates(manager, recordings.map(({ id }) => id));
  return recordings.map((recording) => ({ recording, releaseDate: dates.get(recording.id)! }));
}

/** Recording entries with their artist credit, which a withdrawn recording does not show. */
export async function withArtistCredits(manager: EntityManager, entries: RecordingEntry[]): Promise<RecordingEntry[]> {
  const shown = entries.map(({ recording }) => recording).filter(notWithdrawn);
  const credits = await recordingArtistCreditEntries(manager, shown);
  return entries.map((entry) =>
    shown.includes(entry.recording) ? { ...entry, artistCredits: credits.filter(({ credit }) => credit.recordingId === entry.recording.id) } : entry,
  );
}

export async function recordingEntries(manager: EntityManager, recordings: Recording[], now: Date): Promise<RecordingEntry[]> {
  const plain = await withPlatformLinks(manager, await withArtistCredits(manager, await plainRecordingEntries(manager, recordings)));
  const ids = recordings.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return plain.map((entry) => ({ ...entry, relations: null }));
  const credits = await manager.find(RecordingContribution, { where: { recordingId: In(ids) }, order: { position: 'ASC', id: 'ASC' } });
  const contributions = await creditEntries(manager, 'recording', credits);
  const genres = await manager.find(RecordingGenre, {
    where: { recordingId: In(ids) },
    relations: { genre: true },
    order: { isPrimary: 'DESC', genreId: 'ASC' },
  });
  const recordingWorks = await recordingWorkEntries(
    manager,
    await manager.find(RecordingWork, { where: { recordingId: In(ids) }, order: { position: { direction: 'ASC', nulls: 'LAST' }, id: 'ASC' } }),
  );
  const tracks = await trackEntries(
    manager,
    await publishedTracksOf(manager)
      .andWhere('track.recording_id IN (:...ids)', { ids })
      .orderBy('track.disc_number', 'ASC')
      .addOrderBy('track.track_number', 'ASC')
      .addOrderBy('track.id', 'ASC')
      .getMany(),
    now,
    false,
  );
  return plain.map((entry) => {
    const { recording } = entry;
    if (!ids.includes(recording.id)) return { ...entry, relations: null };
    const own = genres.filter(({ recordingId }) => recordingId === recording.id);
    return {
      ...entry,
      relations: {
        contributions: contributions.filter(({ credit }) => (credit as RecordingContribution).recordingId === recording.id),
        genres: own.map(({ genre }) => genre!),
        primaryGenreId: own.find(({ isPrimary }) => isPrimary)?.genreId ?? null,
        recordingWorks: recordingWorks.filter(({ row }) => row.recordingId === recording.id),
        tracks: tracks.filter(({ track }) => track.recordingId === recording.id),
      },
    };
  });
}

/** The tracks of published editions: the tracks of a withdrawn edition are part of its withdrawn content. */
export function publishedTracksOf(manager: EntityManager): SelectQueryBuilder<Track> {
  return manager
    .createQueryBuilder(Track, 'track')
    .innerJoin(Edition, 'edition', 'edition.id = track.edition_id')
    .innerJoin(EditorialEntity, 'edition_root', 'edition_root.id = edition.editorial_entity_id')
    .where(`edition_root.publication_status = 'published'`);
}

/** Credits with their identities and roles, in the given order. */
export async function creditEntries(manager: EntityManager, scope: CreditScope, credits: Credit[]): Promise<CreditEntry[]> {
  if (credits.length === 0) return [];
  const identities = await identityEntriesById(manager, credits.map(({ catalogIdentityId }) => catalogIdentityId));
  const roles = await manager.find(ContributionRole, {
    where: { id: In([...new Set(credits.map(({ contributionRoleId }) => contributionRoleId))]) },
    relations: { allowedScopes: true },
  });
  return credits.map((credit) => ({
    scope,
    credit,
    identity: identities.get(credit.catalogIdentityId)!,
    role: roles.find(({ id }) => id === credit.contributionRoleId)!,
  }));
}

/** Links between recordings and works, with both ends as entries without relations. */
async function recordingWorkEntries(manager: EntityManager, rows: RecordingWork[]): Promise<RecordingWorkEntry[]> {
  if (rows.length === 0) return [];
  const works = await plainWorkEntries(
    manager,
    await manager.find(Work, { where: { id: In([...new Set(rows.map(({ workId }) => workId))]) }, relations: { editorialEntity: true } }),
  );
  const recordings = await plainRecordingEntries(
    manager,
    await manager.find(Recording, { where: { id: In([...new Set(rows.map(({ recordingId }) => recordingId))]) }, relations: { editorialEntity: true } }),
  );
  return rows.map((row) => ({
    row,
    work: works.find(({ work }) => work.id === row.workId)!,
    recording: recordings.find(({ recording }) => recording.id === row.recordingId)!,
  }));
}
