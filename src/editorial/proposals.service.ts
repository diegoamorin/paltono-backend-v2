import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { CollectionQuery } from '../common/json-api/query';
import { entityNotFound, invalid, isStaff, lockContributor, proposalNotFound } from './editorial-access';
import { withLinks } from './change-links.service';
import { dependencyCycle, hasDependencyCycle } from './dependency-graph';
import { lockOwnDraft } from './drafts';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
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
      const proposal = await lockOwnDraft(manager, user, id);
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
        errors.push(...(await revalidateChange(manager, proposal, change, roots.get(change.entityId))));
      }
      if (errors.length > 0) throw invalid(errors);

      // References imply dependencies besides the declared ones, and together they must stay acyclic.
      for (const change of changes) await recordImpliedDependencies(manager, change, roots.get(change.entityId)!);
      if (await hasDependencyCycle(manager, id)) throw invalid([dependencyCycle()]);
      const now = this.clock.now();
      await manager.update(ChangeProposal, { id }, { status: 'open', submittedAt: now, updatedAt: now });
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
  async history(viewer: User | undefined, entityId: string, query: CollectionQuery): Promise<{ proposals: ChangeProposal[]; total: number }> {
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

    for (const { field, direction } of query.sort) submissions.addOrderBy(`proposal.${field}`, direction);
    const { skip, take } = pageWindow(query);
    const page = await submissions.offset(skip).limit(take).getMany();
    const proposals = await Promise.all(page.map(({ id }) => loadContents(this.dataSource.manager, id)));
    return { proposals, total };
  }
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
