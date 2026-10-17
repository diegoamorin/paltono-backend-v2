import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery } from '../common/json-api/query';
import { LoadedDecision } from './change-decision.resource';
import { ManualDecisionAction } from './dto/change-decision.dto';
import { changeNotFound, invalid, isStaff, lockContributor } from './editorial-access';
import { ChangeDecision, DecisionAction } from './entities/change-decision.entity';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';
import { ChangeStatus, ProposalChange, ValueEnvelope } from './entities/proposal-change.entity';
import { ChangeDependency } from './entities/proposal-links.entity';
import { ABSENT, OperationDefinition, RowKey, findOperation } from './operation-registry';
import { lockTargetedRoots, revalidateChange } from './proposal-changes.service';
import { resolveKey } from './row-references';

export interface DecisionInput {
  action: ManualDecisionAction;
  reason?: string | null;
  confirmedVersion?: number | null;
}

const OPEN_STATUSES: ChangeStatus[] = ['pending', 'conflicted'];

/** What a decision's transaction committed, and the conflict it found instead of applying, if any. */
interface Outcome {
  decisions: LoadedDecision[];
  conflict: ChangeDecision | null;
}

/** Review decisions on the microchanges of submissions, and their history. */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /**
   * Decides a microchange in one transaction: the decision, the domain write,
   * the revision, the root's new version, the automatic decisions on competing
   * microchanges and the closing of their proposals commit together or not at
   * all. Locks follow the order of submissions: the acting account, the
   * proposals in id order, the targeted root, then the microchanges.
   *
   * Applying never overwrites a changed base: a plain `apply` then records the
   * conflict, commits it and answers 409, and only `apply_rebased`, confirming
   * the root's current version, applies over the new base.
   */
  async decide(user: User, changeId: string, input: DecisionInput): Promise<LoadedDecision[]> {
    const outcome = await this.dataSource.transaction(async (manager): Promise<Outcome> => {
      // Shared, so a concurrent role change or suspension waits until this decision commits.
      const actor = await lockContributor(manager, user.id);
      if (!isStaff(actor)) {
        throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'staff_required', detail: 'Only moderators and administrators decide microchanges' }]);
      }
      const located = await findSubmittedChange(manager, changeId);
      checkInput(input);

      // Applying a field can resolve competing microchanges of other submissions, so their proposals are locked too.
      const competingProposalIds = located.operation === 'set_fields' ? await findCompetingProposalIds(manager, located) : [];
      const proposalIds = [...new Set([located.proposalId, ...competingProposalIds])].sort();
      const proposals = new Map<string, ChangeProposal>();
      for (const id of proposalIds) {
        proposals.set(id, await manager.findOneOrFail(ChangeProposal, { where: { id }, lock: { mode: 'pessimistic_write' } }));
      }
      const root = (await lockTargetedRoots(manager, [located])).get(located.entityId)!;
      const change = await manager.findOneOrFail(ProposalChange, { where: { id: changeId }, lock: { mode: 'pessimistic_write' } });
      if (!OPEN_STATUSES.includes(change.status)) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'change_resolved', detail: `The microchange is already ${change.status}; a terminal decision is never reopened` },
        ]);
      }

      const definition = findOperation(root.entityType, change.operation, change.targetPath, change.payloadSchemaVersion)!;
      const now = this.clock.now();
      const value = (change.proposedValue as { value?: unknown }).value;
      // A row or root its key names that is not created yet holds nothing.
      const key = change.targetKey === null ? null : (await resolveKey(manager, root, change.targetKey)).key;
      const current = change.targetKey !== null && key === null ? ABSENT : await definition.read(manager, root, key, value);
      const decisionOf = (action: DecisionAction, resultingStatus: ChangeStatus, actorId: number | null, reason: string | null): ChangeDecision => ({
        id: randomUUID(),
        changeId,
        actorId,
        action,
        previousStatus: change.status,
        resultingStatus,
        reason,
        observedVersion: root.currentVersion,
        observedValue: current,
        decidedAt: now,
      });

      let decision: ChangeDecision;
      if (input.action === 'reject') {
        decision = decisionOf('reject', 'rejected', actor.id, input.reason!);
        await manager.insert(ChangeDecision, decision);
      } else {
        const dependsOn = await checkDependencies(manager, change);
        // The payload and its references are checked again on the state this transaction sees.
        const errors = await revalidateChange(manager, proposals.get(change.proposalId)!, change, root, 'decision');
        if (errors.length > 0) throw invalid(errors);

        // Rows are compared by their keys and the root's constraints, never as a whole list.
        const clashes = (await definition.constraintProblems?.(manager, root, key, value)) ?? [];
        const conflicted = change.status === 'conflicted' || clashes.length > 0 || (await baseChanged(manager, change, current, key, dependsOn));
        if (change.operation !== 'create_entity' && isDeepStrictEqual(current, change.proposedValue)) {
          // The result already exists: it closes without a write or a new version.
          decision = decisionOf('mark_satisfied', 'satisfied', null, null);
          await manager.insert(ChangeDecision, decision);
        } else if (input.action === 'apply' && conflicted) {
          if (change.status === 'conflicted') throw baseChangedError(root.currentVersion, current);
          const reason = clashes[0] ?? `La base de ${change.targetPath} cambió después de la versión ${change.baseVersion} de la ficha`;
          decision = decisionOf('mark_conflict', 'conflicted', null, reason);
          await manager.insert(ChangeDecision, decision);
          await manager.update(ProposalChange, { id: changeId }, { status: 'conflicted' });
          return { decisions: await loadDecisions(manager, [decision.id]), conflict: decision };
        } else {
          if (input.action === 'apply_rebased') {
            if (!conflicted) {
              throw new JsonApiException(HttpStatus.CONFLICT, [
                { code: 'base_unchanged', detail: 'The base of the microchange did not change; apply it without rebasing' },
              ]);
            }
            // A modification after the confirmation was given needs a new look, not the stale confirmation.
            if (input.confirmedVersion !== root.currentVersion) throw staleConfirmationError(root.currentVersion, current);
            // A new base is confirmed; the root's constraints never are.
            if (clashes.length > 0) {
              throw new JsonApiException(HttpStatus.CONFLICT, clashes.map((detail) => ({ code: 'constraint_violated', detail })));
            }
          }
          decision = decisionOf(input.action, 'applied', actor.id, input.reason || null);
          const version = await applyChange(manager, definition, root, change, key, decision, now);
          if (change.operation === 'set_fields') await settleCompetingChanges(manager, change, version, proposals, now);
        }
      }

      await manager.update(ProposalChange, { id: changeId }, { status: decision.resultingStatus, resolvedAt: now });
      await closeIfSettled(manager, change.proposalId, now);
      return { decisions: await loadDecisions(manager, [decision.id]), conflict: null };
    });
    if (outcome.conflict) throw baseChangedError(outcome.conflict.observedVersion, outcome.conflict.observedValue);
    return outcome.decisions;
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
async function closeIfSettled(manager: EntityManager, proposalId: string, now: Date): Promise<void> {
  if (await manager.existsBy(ProposalChange, { proposalId, status: In(OPEN_STATUSES) })) return;
  await manager.update(ChangeProposal, { id: proposalId }, { status: 'closed', closedAt: now, updatedAt: now });
}

/** `apply_rebased` needs the confirmed version, and a reason as rejecting does; no other action takes a version. */
function checkInput({ action, reason, confirmedVersion }: DecisionInput): void {
  if ((action === 'reject' || action === 'apply_rebased') && !reason) {
    const detail = action === 'reject' ? 'Rejecting needs a reason' : 'Applying over a new base needs a reason';
    throw invalid([{ code: 'reason_required', detail, source: { pointer: '/data/attributes/reason' } }]);
  }
  const source = { pointer: '/data/attributes/confirmedVersion' };
  const confirmed = confirmedVersion !== undefined && confirmedVersion !== null;
  if (action === 'apply_rebased' && !confirmed) {
    throw invalid([{ code: 'confirmed_version_required', detail: 'Applying over a new base confirms the current version of the root', source }]);
  }
  if (action !== 'apply_rebased' && confirmed) {
    throw invalid([{ code: 'confirmed_version_not_allowed', detail: 'Only apply_rebased confirms a version', source }]);
  }
}

/** The open submissions with another open microchange on the same field of the same root. */
async function findCompetingProposalIds(manager: EntityManager, change: ProposalChange): Promise<string[]> {
  const rows: { proposalId: string }[] = await manager
    .createQueryBuilder(ProposalChange, 'change')
    .select('DISTINCT change.proposal_id', 'proposalId')
    .innerJoin('change.proposal', 'proposal')
    .where('change.entity_id = :entityId', { entityId: change.entityId })
    .andWhere('change.target_path = :targetPath', { targetPath: change.targetPath })
    .andWhere('change.id <> :id', { id: change.id })
    .andWhere('change.status IN (:...statuses)', { statuses: OPEN_STATUSES })
    .andWhere(`proposal.status = 'open'`)
    .getRawMany();
  return rows.map(({ proposalId }) => proposalId);
}

/**
 * The microchanges a microchange depends on, which must all be applied before
 * it: the rows and roots its key names exist only then.
 */
async function checkDependencies(manager: EntityManager, change: ProposalChange): Promise<string[]> {
  const dependencies = await manager.findBy(ChangeDependency, { changeId: change.id });
  const dependsOn = dependencies.map(({ dependsOnChangeId }) => dependsOnChangeId);
  if (dependsOn.length > 0 && (await manager.existsBy(ProposalChange, { id: In(dependsOn), status: Not('applied') }))) {
    throw new JsonApiException(HttpStatus.CONFLICT, [
      { code: 'dependency_unresolved', detail: 'Apply the microchanges this one depends on first', meta: { dependsOn } },
    ]);
  }
  return dependsOn;
}

/**
 * Whether the data a microchange was based on changed: its target holds
 * another value, or a later revision wrote the target even if it went back to
 * the base value. A change elsewhere in the root does not count: for a
 * relation, only revisions of the same row do, besides those of the
 * microchanges it depends on, such as the insertion that created the row.
 * An insertion has no row yet; the root's constraints judge it instead.
 */
async function baseChanged(
  manager: EntityManager,
  change: ProposalChange,
  current: ValueEnvelope,
  key: RowKey | null,
  dependsOn: string[],
): Promise<boolean> {
  if (!isDeepStrictEqual(current, change.baseValue)) return true;
  if (change.operation === 'add_relation') return false;
  const revisions = manager
    .createQueryBuilder(EntityRevision, 'revision')
    .innerJoin(ProposalChange, 'change', 'change.id = revision.change_id')
    .where('revision.entity_id = :entityId', { entityId: change.entityId })
    .andWhere('revision.version > :baseVersion', { baseVersion: change.baseVersion })
    .andWhere('change.target_path = :targetPath', { targetPath: change.targetPath });
  if (key) revisions.andWhere('revision.result_key = :key::jsonb', { key: JSON.stringify(key) });
  if (dependsOn.length > 0) revisions.andWhere('revision.change_id NOT IN (:...dependsOn)', { dependsOn });
  return revisions.getExists();
}

/** Writes the domain change, the decision and the revision, and consumes a version of the root. Returns that version. */
async function applyChange(
  manager: EntityManager,
  definition: OperationDefinition,
  root: EditorialEntity,
  change: ProposalChange,
  key: RowKey | null,
  decision: ChangeDecision,
  now: Date,
): Promise<number> {
  const applied = await definition.apply(manager, root, (change.proposedValue as { value?: unknown }).value, now, key);
  await manager.insert(ChangeDecision, decision);
  const version = root.currentVersion + 1;
  await manager.insert(EntityRevision, {
    id: randomUUID(),
    entityId: root.id,
    version,
    changeId: change.id,
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
        ? { publicationStatus: 'published' as const, creationChangeId: change.id, publishedAt: now }
        : {}),
    },
  );
  return version;
}

/**
 * After a field is written, each open microchange of the locked proposals on
 * that field either already holds its result, and is satisfied, or lost its
 * base, and is in conflict. Automatic decisions are recorded only for new
 * transitions. A competitor submitted meanwhile, outside the locked proposals,
 * is checked again when someone applies it.
 */
async function settleCompetingChanges(
  manager: EntityManager,
  applied: ProposalChange,
  version: number,
  proposals: Map<string, ChangeProposal>,
  now: Date,
): Promise<void> {
  const competitors = await manager.find(ProposalChange, {
    where: {
      entityId: applied.entityId,
      targetPath: applied.targetPath,
      status: In(OPEN_STATUSES),
      proposalId: In([...proposals.keys()]),
      id: Not(applied.id),
    },
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });
  if (competitors.length === 0) return;
  const root = await manager.findOneByOrFail(EditorialEntity, { id: applied.entityId });
  const definition = findOperation(root.entityType, applied.operation, applied.targetPath, applied.payloadSchemaVersion)!;
  const current = await definition.read(manager, root, null, undefined);

  for (const competitor of competitors) {
    const satisfied = isDeepStrictEqual(current, competitor.proposedValue);
    if (!satisfied && competitor.status === 'conflicted') continue;
    const resultingStatus = satisfied ? 'satisfied' : 'conflicted';
    await manager.insert(ChangeDecision, {
      id: randomUUID(),
      changeId: competitor.id,
      actorId: null,
      action: satisfied ? 'mark_satisfied' : 'mark_conflict',
      previousStatus: competitor.status,
      resultingStatus,
      reason: satisfied ? null : `La versión ${version} de la ficha cambió ${applied.targetPath}, la base de este microcambio`,
      observedVersion: version,
      observedValue: current,
      decidedAt: now,
    });
    await manager.update(ProposalChange, { id: competitor.id }, { status: resultingStatus, resolvedAt: satisfied ? now : null });
    if (satisfied) await closeIfSettled(manager, competitor.proposalId, now);
  }
}

/** A 409 for a base that changed, with the root's current version and value, which `apply_rebased` confirms. */
function baseChangedError(currentVersion: number, currentValue: ValueEnvelope): JsonApiException {
  const detail = 'The base of the microchange changed; confirm the current version with apply_rebased to apply it over the new base';
  return new JsonApiException(HttpStatus.CONFLICT, [{ code: 'base_changed', detail, meta: { currentVersion, currentValue } }]);
}

/** A 409 for a confirmation of a version the root has moved past. */
function staleConfirmationError(currentVersion: number, currentValue: ValueEnvelope): JsonApiException {
  const detail = 'The root changed after the confirmed version; review it and confirm its current version again';
  return new JsonApiException(HttpStatus.CONFLICT, [{ code: 'stale_confirmation', detail, meta: { currentVersion, currentValue } }]);
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
