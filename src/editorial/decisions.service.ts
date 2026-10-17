import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery } from '../common/json-api/query';
import { LoadedDecision } from './change-decision.resource';
import { ManualDecisionAction } from './dto/change-decision.dto';
import { changeNotFound, invalid, isStaff, lockContributor } from './editorial-access';
import { ChangeDecision } from './entities/change-decision.entity';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';
import { ChangeStatus, ProposalChange } from './entities/proposal-change.entity';
import { findOperation } from './operation-registry';
import { lockTargetedRoots, revalidateChange } from './proposal-changes.service';

export interface DecisionInput {
  action: ManualDecisionAction;
  reason?: string | null;
}

const OPEN_STATUSES: ChangeStatus[] = ['pending', 'conflicted'];

/** Review decisions on the microchanges of submissions, and their history. */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /**
   * Decides a microchange in one transaction: the decision, the domain write,
   * the revision, the root's new version and the closing of its proposal
   * commit together or not at all. Locks follow the order of submissions: the
   * acting account, the proposal, the targeted root, then the microchange.
   */
  decide(user: User, changeId: string, input: DecisionInput): Promise<LoadedDecision[]> {
    return this.dataSource.transaction(async (manager) => {
      // Shared, so a concurrent role change or suspension waits until this decision commits.
      const actor = await lockContributor(manager, user.id);
      if (!isStaff(actor)) {
        throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'staff_required', detail: 'Only moderators and administrators decide microchanges' }]);
      }
      const located = await findSubmittedChange(manager, changeId);
      if (input.action === 'reject' && !input.reason) {
        throw invalid([{ code: 'reason_required', detail: 'Rejecting needs a reason', source: { pointer: '/data/attributes/reason' } }]);
      }

      const proposal = await manager.findOneOrFail(ChangeProposal, { where: { id: located.proposalId }, lock: { mode: 'pessimistic_write' } });
      const root = (await lockTargetedRoots(manager, [located])).get(located.entityId)!;
      const change = await manager.findOneOrFail(ProposalChange, { where: { id: changeId }, lock: { mode: 'pessimistic_write' } });
      if (!OPEN_STATUSES.includes(change.status)) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'change_resolved', detail: `The microchange is already ${change.status}; a terminal decision is never reopened` },
        ]);
      }

      const definition = findOperation(root.entityType, change.operation, change.targetPath, change.payloadSchemaVersion)!;
      const now = this.clock.now();
      const decision: ChangeDecision = {
        id: randomUUID(),
        changeId,
        actorId: actor.id,
        action: input.action,
        previousStatus: change.status,
        resultingStatus: input.action === 'apply' ? 'applied' : 'rejected',
        reason: input.reason || null,
        observedVersion: root.currentVersion,
        observedValue: await definition.read(manager, root),
        decidedAt: now,
      };

      if (input.action === 'apply') {
        // The payload and its references are checked again on the state this transaction sees.
        const errors = await revalidateChange(manager, proposal, change, root);
        if (errors.length > 0) throw invalid(errors);
        const applied = await definition.apply(manager, root, (change.proposedValue as { value: unknown }).value, now);
        await manager.insert(ChangeDecision, decision);
        const version = root.currentVersion + 1;
        await manager.insert(EntityRevision, {
          id: randomUUID(),
          entityId: root.id,
          version,
          changeId,
          decisionId: decision.id,
          beforeValue: decision.observedValue,
          afterValue: applied.afterValue,
          resultKey: applied.resultKey,
          appliedAt: now,
        });
        await manager.update(
          EditorialEntity,
          { id: root.id },
          {
            currentVersion: version,
            ...(change.operation === 'create_entity'
              ? { publicationStatus: 'published' as const, creationChangeId: changeId, publishedAt: now }
              : {}),
          },
        );
      } else {
        await manager.insert(ChangeDecision, decision);
      }

      await manager.update(ProposalChange, { id: changeId }, { status: decision.resultingStatus, resolvedAt: now });
      await closeIfSettled(manager, proposal, now);
      return loadDecisions(manager, [decision.id]);
    });
  }

  /** The decisions on a microchange, automatic ones included. Only its author and staff read them. */
  async history(viewer: User, changeId: string, query: CollectionQuery): Promise<{ decisions: LoadedDecision[]; total: number }> {
    const manager = this.dataSource.manager;
    const change = await findSubmittedChange(manager, changeId);
    if (change.proposal!.authorId !== viewer.id && !isStaff(viewer)) {
      throw new JsonApiException(HttpStatus.FORBIDDEN, [
        { code: 'not_change_reviewer', detail: 'Only the author of the microchange and staff see its decisions' },
      ]);
    }
    const { skip, take } = pageWindow(query);
    const [page, total] = await manager.findAndCount(ChangeDecision, {
      where: { changeId },
      order: Object.fromEntries(query.sort.map(({ field, direction }) => [field, direction])),
      skip,
      take,
    });
    return { decisions: await loadDecisions(manager, page.map(({ id }) => id)), total };
  }
}

/** A microchange of a submission. Those of drafts are private to their author and never decided. */
async function findSubmittedChange(manager: EntityManager, changeId: string): Promise<ProposalChange> {
  const change = await manager.findOne(ProposalChange, { where: { id: changeId }, relations: { proposal: true } });
  if (!change || change.proposal!.status === 'draft') throw changeNotFound();
  return change;
}

/** A submission stays open while any of its microchanges is pending or conflicted. */
async function closeIfSettled(manager: EntityManager, proposal: ChangeProposal, now: Date): Promise<void> {
  if (await manager.existsBy(ProposalChange, { proposalId: proposal.id, status: In(OPEN_STATUSES) })) return;
  await manager.update(ChangeProposal, { id: proposal.id }, { status: 'closed', closedAt: now, updatedAt: now });
}

/** Decisions in the given order, with their actors and revisions. */
async function loadDecisions(manager: EntityManager, ids: string[]): Promise<LoadedDecision[]> {
  if (ids.length === 0) return [];
  const decisions = await manager.find(ChangeDecision, { where: { id: In(ids) }, relations: { actor: true } });
  const revisions = await manager.findBy(EntityRevision, { decisionId: In(ids) });
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  return ids.map((id) => {
    const decision = byId.get(id)!;
    return Object.assign(decision, { revision: revisions.find(({ decisionId }) => decisionId === id) ?? null });
  });
}
