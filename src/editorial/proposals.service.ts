import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { accountNotFound } from '../accounts/administration';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { CatalogImageUrls } from '../images/catalog-image-urls';
import { pageWindow } from '../common/json-api/document';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { entityNotFound, invalid, isStaff, listFilter, lockContributor, proposalNotFound, uuidFilter } from './editorial-access';
import { withLinks } from './change-links.service';
import { dependencyCycle, hasDependencyCycle } from './dependency-graph';
import { lockOwnDraft } from './drafts';
import { ChangeProposal, PROPOSAL_STATUSES, ProposalStatus } from './entities/change-proposal.entity';
import { EDITORIAL_ENTITY_TYPES, EditorialEntity } from './entities/editorial-entity.entity';
import { ProposalChange } from './entities/proposal-change.entity';
import { ProposalSource } from './entities/proposal-source.entity';
import { ChangeDependency, ChangeSource } from './entities/proposal-links.entity';
import { lockTargetedRoots, recordImpliedDependencies, revalidateChange } from './proposal-changes.service';

/** Which projection of a proposal a viewer gets: see `proposal.resource.ts`. */
export type ProposalView = 'public' | 'reviewable';

export interface ViewedProposal {
  proposal: ChangeProposal;
  view: ProposalView;
}

export interface ProposalPage {
  proposals: ChangeProposal[];
  total: number;
}

export interface ProposalInput {
  description?: string;
  /** `null` removes the link; `undefined` keeps it. */
  previousProposalId?: string | null;
}

/** Proposals: drafts, their submission and the reads of both. */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly images: CatalogImageUrls,
  ) {}

  create(user: User, input: ProposalInput): Promise<ChangeProposal> {
    return this.dataSource.transaction(async (manager) => {
      const author = await lockContributor(manager, user.id);
      const now = this.clock.now();
      const id = randomUUID();
      const previousProposalId = input.previousProposalId ?? null;
      if (previousProposalId) await checkPredecessor(manager, author, previousProposalId);
      await manager.insert(ChangeProposal, {
        id,
        authorId: author.id,
        description: input.description ?? '',
        status: 'draft',
        previousProposalId,
        createdAt: now,
        updatedAt: now,
        submittedAt: null,
        closedAt: null,
      });
      return manager.findOneOrFail(ChangeProposal, { where: { id }, relations: { author: true } });
    });
  }

  update(user: User, id: string, input: ProposalInput): Promise<ChangeProposal> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, id);
      if (input.previousProposalId) await checkPredecessor(manager, user, input.previousProposalId);
      await manager.update(
        ChangeProposal,
        { id },
        {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.previousProposalId !== undefined ? { previousProposalId: input.previousProposalId } : {}),
          updatedAt: this.clock.now(),
        },
      );
      return loadContents(manager, proposal.id);
    });
  }

  /** Deletes a draft with its content. It is not a moderation decision and leaves no trace. */
  discard(user: User, id: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await lockOwnDraft(manager, user, id);
      await manager.delete(ChangeSource, { proposalId: id });
      await manager.delete(ChangeDependency, { proposalId: id });
      await manager.delete(ProposalSource, { proposalId: id });
      await manager.delete(ProposalChange, { proposalId: id });
      await manager.delete(ChangeProposal, { id });
    });
  }

  /**
   * Submits a draft: requires a description, a microchange, a general source,
   * valid payloads and an acyclic dependency graph, then freezes the content.
   * Only the review state can change afterwards.
   */
  submit(user: User, id: string): Promise<ChangeProposal> {
    return this.dataSource.transaction(async (manager) => {
      await submitDraft(manager, await lockOwnDraft(manager, user, id), this.clock.now(), this.images);
      return loadContents(manager, id);
    });
  }

  /** A proposal as the viewer may see it: drafts only exist for their author. */
  async show(viewer: User | undefined, id: string): Promise<ViewedProposal> {
    const proposal = await this.dataSource.manager.findOne(ChangeProposal, { where: { id } });
    if (!proposal || (proposal.status === 'draft' && proposal.authorId !== viewer?.id)) throw proposalNotFound();
    const view = viewer && (viewer.id === proposal.authorId || isStaff(viewer)) ? 'reviewable' : 'public';
    return { proposal: await loadContents(this.dataSource.manager, id), view };
  }

  /**
   * The public history of a root: every submission with a microchange on it.
   * A reservation nobody has submitted anything for only exists for its creator.
   */
  async history(viewer: User | undefined, entityId: string, query: CollectionQuery): Promise<ProposalPage> {
    const entity = await this.dataSource.manager.findOneBy(EditorialEntity, { id: entityId });
    if (!entity) throw entityNotFound();

    const submissions = this.dataSource.manager
      .createQueryBuilder(ChangeProposal, 'proposal')
      .where(`proposal.status <> 'draft'`)
      .andWhere('EXISTS (SELECT 1 FROM proposal_changes change WHERE change.proposal_id = proposal.id AND change.entity_id = :entityId)', {
        entityId,
      });
    const total = await submissions.getCount();
    if (total === 0 && entity.publicationStatus === 'reserved' && entity.createdById !== viewer?.id) throw entityNotFound();

    return { proposals: await this.page(submissions, query), total };
  }

  /** The viewer's own proposals, drafts included (E7). */
  async listOwn(viewer: User, query: CollectionQuery): Promise<ProposalPage> {
    const proposals = this.dataSource.manager
      .createQueryBuilder(ChangeProposal, 'proposal')
      .where('proposal.author_id = :authorId', { authorId: viewer.id });
    filterProposals(proposals, query, PROPOSAL_STATUSES);
    return { total: await proposals.getCount(), proposals: await this.page(proposals, query) };
  }

  /** The submissions of an account, which are public; never its drafts (A19). */
  async listSubmissions(accountUuid: string, query: CollectionQuery): Promise<ProposalPage> {
    const author = await this.dataSource.manager.findOneBy(User, { uuid: accountUuid });
    if (!author) throw accountNotFound();
    const submissions = this.dataSource.manager
      .createQueryBuilder(ChangeProposal, 'proposal')
      .where('proposal.author_id = :authorId', { authorId: author.id })
      .andWhere(`proposal.status <> 'draft'`);
    filterProposals(submissions, query, ['open', 'closed']);
    return { total: await submissions.getCount(), proposals: await this.page(submissions, query) };
  }

  /** One page of the given proposals in the query's order, each with its contents. */
  private async page(proposals: SelectQueryBuilder<ChangeProposal>, query: CollectionQuery): Promise<ChangeProposal[]> {
    for (const { field, direction } of query.sort) proposals.addOrderBy(`proposal.${field}`, direction);
    const { skip, take } = pageWindow(query);
    const page = await proposals.offset(skip).limit(take).getMany();
    return Promise.all(page.map(({ id }) => loadContents(this.dataSource.manager, id)));
  }
}

/**
 * Applies the filters of the lists of proposals: `status`, one or several
 * among the given ones; `entity`, a root some microchange targets; and
 * `entityType`, the type of such a root. Values outside them answer 400.
 */
function filterProposals(proposals: SelectQueryBuilder<ChangeProposal>, query: CollectionQuery, statuses: readonly ProposalStatus[]): void {
  const { status, entity, entityType } = query.filter;
  if (status !== undefined) proposals.andWhere('proposal.status IN (:...statuses)', { statuses: listFilter('filter[status]', status, statuses) });
  if (entity !== undefined) {
    proposals.andWhere('EXISTS (SELECT 1 FROM proposal_changes change WHERE change.proposal_id = proposal.id AND change.entity_id = :entity)', {
      entity: uuidFilter('filter[entity]', entity),
    });
  }
  if (entityType !== undefined) {
    requireOneOf('filter[entityType]', entityType, EDITORIAL_ENTITY_TYPES);
    proposals.andWhere(
      `EXISTS (SELECT 1 FROM proposal_changes change JOIN editorial_entities root ON root.id = change.entity_id
        WHERE change.proposal_id = proposal.id AND root.entity_type = :entityType)`,
      { entityType },
    );
  }
}

/**
 * Submits a draft its author has locked: checks it as a submission, records
 * the dependencies its references imply and freezes it. The targeted roots
 * stay locked until the transaction ends.
 */
export async function submitDraft(manager: EntityManager, proposal: ChangeProposal, now: Date, images: CatalogImageUrls): Promise<void> {
  const { id } = proposal;
  const changes = await manager.find(ProposalChange, { where: { proposalId: id }, order: { position: 'ASC' } });
  const sources = await manager.countBy(ProposalSource, { proposalId: id });

  const errors: JsonApiErrorInput[] = [];
  if (proposal.description.trim() === '') {
    errors.push({ code: 'description_required', detail: 'A submission needs a description' });
  }
  if (changes.length === 0) errors.push({ code: 'changes_required', detail: 'A submission needs at least one microchange' });
  if (sources === 0) errors.push({ code: 'sources_required', detail: 'A submission needs at least one general source' });
  // Locked, so no other submission can claim the same reservations meanwhile.
  const roots = await lockTargetedRoots(manager, changes);
  for (const change of changes) {
    errors.push(...(await revalidateChange(manager, proposal, change, roots.get(change.entityId), { stage: 'submission', images })));
  }
  if (errors.length > 0) throw invalid(errors);

  // References imply dependencies besides the declared ones, and together they must stay acyclic.
  for (const change of changes) await recordImpliedDependencies(manager, change, roots.get(change.entityId)!);
  if (await hasDependencyCycle(manager, id)) throw invalid([dependencyCycle()]);
  await manager.update(ChangeProposal, { id }, { status: 'open', submittedAt: now, updatedAt: now });
}

/** A proposal with its author, its microchanges in order and its sources. */
export async function loadContents(manager: EntityManager, id: string): Promise<ChangeProposal> {
  const proposal = await manager.findOneOrFail(ChangeProposal, { where: { id }, relations: { author: true } });
  proposal.changes = await withLinks(manager, await manager.find(ProposalChange, { where: { proposalId: id }, order: { position: 'ASC' } }));
  proposal.sources = await manager.find(ProposalSource, { where: { proposalId: id }, order: { createdAt: 'ASC', id: 'ASC' } });
  return proposal;
}

/** A correction links to an earlier submission of the same author. */
async function checkPredecessor(manager: EntityManager, author: User, previousProposalId: string): Promise<void> {
  const previous = await manager.findOneBy(ChangeProposal, { id: previousProposalId });
  if (!previous || previous.authorId !== author.id || previous.status === 'draft') {
    throw invalid([
      {
        code: 'invalid_previous_proposal',
        detail: 'The previous proposal must be an earlier submission of the same author',
        source: { pointer: '/data/relationships/previousProposal/data/id' },
      },
    ]);
  }
}
