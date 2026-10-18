import { EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { EditorialEntity } from '../editorial/entities/editorial-entity.entity';
import { Release } from './entities/release.entity';
import { Track } from './entities/track.entity';
import { trackEntries } from './track-entries';
import { identityEntriesById } from '../catalog-identities/identities.service';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Recording, RecordingContribution, RecordingGenre, RecordingWork } from './entities/recording.entity';
import { Credit, Work, WorkContribution } from './entities/work.entity';
import { CreditEntry, CreditScope, RecordingEntry, RecordingWorkEntry, WorkEntry } from './music.resource';

/*
 * Loads works and recordings as entries with their relations. The targets of
 * those relations are entries without relations of their own, as an include
 * reaches at most two levels.
 */

const notWithdrawn = (root: Work | Recording) => root.editorialEntity!.publicationStatus !== 'withdrawn';

export async function workEntries(manager: EntityManager, works: Work[]): Promise<WorkEntry[]> {
  const ids = works.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return works.map((work) => ({ work, relations: null }));
  const credits = await manager.find(WorkContribution, { where: { workId: In(ids) }, order: { position: 'ASC', id: 'ASC' } });
  const contributions = await creditEntries(manager, 'work', credits);
  const recordingWorks = await recordingWorkEntries(
    manager,
    await manager.find(RecordingWork, { where: { workId: In(ids) }, order: { recordingId: 'ASC', position: 'ASC', id: 'ASC' } }),
  );
  return works.map((work) => ({
    work,
    relations: ids.includes(work.id)
      ? {
          contributions: contributions.filter(({ credit }) => (credit as WorkContribution).workId === work.id),
          recordingWorks: recordingWorks.filter(({ row }) => row.workId === work.id),
        }
      : null,
  }));
}

export async function recordingEntries(manager: EntityManager, recordings: Recording[], now: Date): Promise<RecordingEntry[]> {
  const ids = recordings.filter(notWithdrawn).map(({ id }) => id);
  if (ids.length === 0) return recordings.map((recording) => ({ recording, relations: null }));
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
  return recordings.map((recording) => {
    if (!ids.includes(recording.id)) return { recording, relations: null };
    const own = genres.filter(({ recordingId }) => recordingId === recording.id);
    return {
      recording,
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

/** The tracks of published releases: the tracks of a withdrawn release are part of its withdrawn content. */
export function publishedTracksOf(manager: EntityManager): SelectQueryBuilder<Track> {
  return manager
    .createQueryBuilder(Track, 'track')
    .innerJoin(Release, 'release', 'release.id = track.release_id')
    .innerJoin(EditorialEntity, 'release_root', 'release_root.id = release.editorial_entity_id')
    .where(`release_root.publication_status = 'published'`);
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
  const works = await manager.find(Work, { where: { id: In([...new Set(rows.map(({ workId }) => workId))]) }, relations: { editorialEntity: true } });
  const recordings = await manager.find(Recording, {
    where: { id: In([...new Set(rows.map(({ recordingId }) => recordingId))]) },
    relations: { editorialEntity: true },
  });
  return rows.map((row) => ({
    row,
    work: { work: works.find(({ id }) => id === row.workId)! },
    recording: { recording: recordings.find(({ id }) => id === row.recordingId)! },
  }));
}
