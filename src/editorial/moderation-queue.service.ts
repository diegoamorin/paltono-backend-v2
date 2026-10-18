import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { withLinks } from './change-links.service';
import { listFilter, uuidFilter } from './editorial-access';
import { EDITORIAL_ENTITY_TYPES } from './entities/editorial-entity.entity';
import { CHANGE_OPERATIONS, ProposalChange } from './entities/proposal-change.entity';
import { ProposalSource } from './entities/proposal-source.entity';

/** The statuses that wait for a decision, the only ones the queue shows. */
const QUEUED_STATUSES = ['pending', 'conflicted'] as const;

/** The work queue of staff: the microchanges of submissions that wait for a decision. */
@Injectable()
export class ModerationQueueService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Pending and conflicted microchanges of open submissions, never of drafts,
   * whose microchanges are pending too. Each comes with its proposal, the
   * proposal's author and sources, and its root.
   */
  async list(query: CollectionQuery): Promise<{ changes: ProposalChange[]; total: number }> {
    const { status, entityType, operation, author, entity } = query.filter;
    const statuses = status === undefined ? QUEUED_STATUSES : listFilter('filter[status]', status, QUEUED_STATUSES);
    const changes = this.dataSource.manager
      .createQueryBuilder(ProposalChange, 'change')
      .innerJoin('change.proposal', 'proposal')
      .innerJoin('change.entity', 'root')
      .where(`proposal.status = 'open'`)
      .andWhere('change.status IN (:...statuses)', { statuses });
    if (entityType !== undefined) {
      requireOneOf('filter[entityType]', entityType, EDITORIAL_ENTITY_TYPES);
      changes.andWhere('root.entity_type = :entityType', { entityType });
    }
    if (operation !== undefined) {
      requireOneOf('filter[operation]', operation, CHANGE_OPERATIONS);
      changes.andWhere('change.operation = :operation', { operation });
    }
    if (author !== undefined) {
      changes.innerJoin('proposal.author', 'author').andWhere('author.uuid = :author', { author: uuidFilter('filter[author]', author) });
    }
    if (entity !== undefined) changes.andWhere('change.entity_id = :entity', { entity: uuidFilter('filter[entity]', entity) });

    for (const { field, direction } of query.sort) changes.addOrderBy(`change.${field}`, direction);
    const { skip, take } = pageWindow(query);
    const [page, total] = await changes.offset(skip).limit(take).getManyAndCount();
    return { changes: await this.load(page.map(({ id }) => id)), total };
  }

  /** The given microchanges in the given order, with their links, proposals, authors, sources and roots. */
  private async load(ids: string[]): Promise<ProposalChange[]> {
    if (ids.length === 0) return [];
    const manager = this.dataSource.manager;
    const loaded = await manager.find(ProposalChange, { where: { id: In(ids) }, relations: { proposal: { author: true }, entity: { createdBy: true } } });
    const sources = await manager.find(ProposalSource, {
      where: { proposalId: In([...new Set(loaded.map(({ proposalId }) => proposalId))]) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    for (const { proposal } of loaded) proposal!.sources = sources.filter(({ proposalId }) => proposalId === proposal!.id);
    const byId = new Map((await withLinks(manager, loaded)).map((change) => [change.id, change]));
    return ids.map((id) => byId.get(id)!);
  }
}
