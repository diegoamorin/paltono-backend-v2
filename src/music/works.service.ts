import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { Work } from './entities/work.entity';
import { workEntries } from './music-entries';
import { WorkEntry } from './music.resource';

/** The column behind each sort field of the list. */
const SORT_COLUMNS: Record<string, string> = { title: 'work.title', createdAt: 'work.created_at', id: 'work.id' };

/**
 * Public reads of works. A row only exists once its creation is applied, so a
 * reservation is never found; a withdrawn one keeps its row and answers with
 * its notice.
 */
@Injectable()
export class WorksService {
  constructor(private readonly dataSource: DataSource) {}

  async show(id: string): Promise<WorkEntry> {
    const work = /^[1-9]\d{0,18}$/.test(id)
      ? await this.dataSource.manager.findOne(Work, { where: { id }, relations: { editorialEntity: true } })
      : null;
    if (!work) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'work_not_found', detail: 'The work does not exist' }]);
    return (await workEntries(this.dataSource.manager, [work]))[0];
  }

  /** Published works only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: WorkEntry[]; total: number }> {
    const { q, slug, iswc, contributor, role } = query.filter;
    const builder = this.dataSource.manager
      .createQueryBuilder(Work, 'work')
      .innerJoinAndSelect('work.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
    if (q !== undefined) builder.andWhere('unaccent(lower(work.title)) LIKE unaccent(lower(:pattern))', { pattern: containsPattern(q) });
    if (slug !== undefined) builder.andWhere('work.slug = :slug', { slug });
    if (iswc !== undefined) builder.andWhere('work.iswc = :iswc', { iswc: iswc.toUpperCase() });
    if (contributor !== undefined || role !== undefined) {
      // One credit has both the contributor and the role, when both are asked for.
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM work_contributions credit
          JOIN catalog_identities credited ON credited.id = credit.catalog_identity_id
          JOIN contribution_roles credit_role ON credit_role.id = credit.contribution_role_id
          WHERE credit.work_id = work.id
            AND (CAST(:contributor AS varchar) IS NULL OR credited.public_id = :contributor)
            AND (CAST(:role AS varchar) IS NULL OR credit_role.slug = :role)
        )`,
        { contributor: contributor ?? null, role: role ?? null },
      );
    }
    for (const { field, direction } of query.sort) builder.addOrderBy(SORT_COLUMNS[field], direction);
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await workEntries(this.dataSource.manager, page), total };
  }
}
