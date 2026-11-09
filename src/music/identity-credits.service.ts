import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { CatalogIdentity } from '../catalog-identities/entities/catalog-identity.entity';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { CONTRIBUTION_ROLE_SCOPES } from '../vocabularies/entities/contribution-role.entity';
import { Recording, RecordingContribution } from './entities/recording.entity';
import { Work, WorkContribution } from './entities/work.entity';
import { Release } from './entities/release.entity';
import { ReleaseContribution } from './entities/track.entity';
import { Clock } from '../common/clock/clock';
import { creditEntries, plainRecordingEntries, plainWorkEntries, withArtistCredits } from './music-entries';
import { CreditEntry, CreditScope } from './resource-primitives';
import { releaseEntries } from './release-entries';
import { recordingReleaseSql, releaseDateSql, workReleaseStartSql } from './release-dates';

/** The scopes a credit filter accepts: those of credits, not of membership roles. */
const CREDIT_SCOPES = CONTRIBUTION_ROLE_SCOPES.filter((scope) => scope !== 'membership');

/** The credits of an identity across works, recordings and releases, on published entries only. */
@Injectable()
export class IdentityCreditsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async list(publicId: string, query: CollectionQuery): Promise<{ entries: CreditEntry[]; total: number }> {
    const { scope, role } = query.filter;
    if (scope !== undefined) requireOneOf('filter[scope]', scope, CREDIT_SCOPES);
    const manager = this.dataSource.manager;
    const identity = await manager.findOne(CatalogIdentity, { where: { publicId }, relations: { editorialEntity: true } });
    if (!identity) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'identity_not_found', detail: 'The identity does not exist' }]);
    // A withdrawn identity shows only its notice, not what it is credited for.
    if (identity.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };

    const byDate = query.sort.find(({ field }) => field === 'releaseDate');
    // The first day of the release date of what each credit credits, only when sorting by it.
    const credits = (table: string, owner: string, ownerTable: string, creditScope: string, releaseStart: string) => `
      SELECT '${creditScope}' AS scope, credit.id, credit.created_at${byDate ? `, ${releaseStart} AS release_start` : ''}
      FROM ${table} credit
      JOIN ${ownerTable} owner ON owner.id = credit.${owner}
      JOIN editorial_entities root ON root.id = owner.editorial_entity_id
      JOIN contribution_roles credit_role ON credit_role.id = credit.contribution_role_id
      WHERE credit.catalog_identity_id = $1 AND root.publication_status = 'published'
        AND ($2::varchar IS NULL OR credit_role.slug = $2)
        AND ($3::varchar IS NULL OR $3 = '${creditScope}')`;
    const union = [
      credits('work_contributions', 'work_id', 'works', 'work', workReleaseStartSql('owner')),
      credits('recording_contributions', 'recording_id', 'recordings', 'recording', recordingReleaseSql('owner').start),
      credits('release_contributions', 'release_id', 'releases', 'release', releaseDateSql('owner').start),
    ].join(' UNION ALL ');
    const parameters = [identity.id, role ?? null, scope ?? null];
    const [{ total }] = await manager.query(`SELECT count(*)::int AS total FROM (${union}) credits`, parameters);
    // By date, those without one go last and a tie keeps the default order.
    const order = byDate
      ? `release_start ${byDate.direction} NULLS LAST, created_at ASC`
      : `created_at ${query.sort.find(({ field }) => field === 'createdAt')?.direction ?? 'ASC'}`;
    const { skip, take } = pageWindow(query);
    const page: { scope: CreditScope; id: number }[] = await manager.query(
      `SELECT scope, id FROM (${union}) credits ORDER BY ${order}, scope ASC, id ASC OFFSET $4 LIMIT $5`,
      [...parameters, skip, take],
    );
    return { entries: await this.load(page), total };
  }

  /** The credits of the page, in its order, with the work, recording or release each one credits. */
  private async load(page: { scope: CreditScope; id: number }[]): Promise<CreditEntry[]> {
    const manager = this.dataSource.manager;
    const idsOf = (scope: string) => page.filter((row) => row.scope === scope).map(({ id }) => id);
    const workCredits = await manager.findBy(WorkContribution, { id: In(idsOf('work')) });
    const recordingCredits = await manager.findBy(RecordingContribution, { id: In(idsOf('recording')) });
    const works = await plainWorkEntries(
      manager,
      await manager.find(Work, { where: { id: In(workCredits.map(({ workId }) => workId)) }, relations: { editorialEntity: true } }),
    );
    // A credited recording shows its artists, so that a discography names them.
    const recordings = await withArtistCredits(
      manager,
      await plainRecordingEntries(
        manager,
        await manager.find(Recording, { where: { id: In(recordingCredits.map(({ recordingId }) => recordingId)) }, relations: { editorialEntity: true } }),
      ),
    );
    const releaseCredits = await manager.findBy(ReleaseContribution, { id: In(idsOf('release')) });
    const releases = await releaseEntries(
      manager,
      await manager.find(Release, { where: { id: In(releaseCredits.map(({ releaseId }) => releaseId)) }, relations: { editorialEntity: true } }),
      this.clock.now(),
      false,
    );
    const entries = [
      ...(await creditEntries(manager, 'work', workCredits)).map((entry) => ({
        ...entry,
        work: works.find(({ work }) => work.id === (entry.credit as WorkContribution).workId)!,
      })),
      ...(await creditEntries(manager, 'recording', recordingCredits)).map((entry) => ({
        ...entry,
        recording: recordings.find(({ recording }) => recording.id === (entry.credit as RecordingContribution).recordingId)!,
      })),
      ...(await creditEntries(manager, 'release', releaseCredits)).map((entry) => ({
        ...entry,
        release: releases.find(({ release }) => release.id === (entry.credit as ReleaseContribution).releaseId)!,
      })),
    ];
    return page.map(({ scope, id }) => entries.find((entry) => entry.scope === scope && entry.credit.id === id)!);
  }
}
