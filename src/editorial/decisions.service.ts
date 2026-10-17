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
import { inDependencyOrder } from './dependency-graph';
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

/** Statuses of a prerequisite that let its dependents apply: its result exists. */
const FULFILLED_STATUSES: ChangeStatus[] = ['applied', 'satisfied'];

/** What a decision's transaction committed, and the conflict it found instead of applying, if any. */
interface Outcome {
  decisions: LoadedDecision[];
  conflict: ChangeDecision | null;
}

/** The locks and context a decision on a microchange, or on its atomic group, works with. */
interface DecisionContext {
  manager: EntityManager;
  actor: User;
  input: DecisionInput;
  proposals: Map<string, ChangeProposal>;
  /** The version of each targeted root when the decision started, which `apply_rebased` confirms. */
  versionsBefore: Map<string, number>;
  now: Date;
}

/** A microchange's target as a decision observes it. */
interface Observation {
  root: EditorialEntity;
  definition: OperationDefinition;
  key: RowKey | null;
  current: ValueEnvelope;
}

/** What applying one member of a decision did, or the conflict that stops it. */
type Step = { decision: ChangeDecision } | { conflict: { change: ProposalChange; reason: string } };

/** Thrown inside a group's savepoint to undo the members applied before a conflict. */
class GroupConflict {
  constructor(readonly change: ProposalChange, readonly reason: string) {}
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
   * and dependent microchanges and the closing of their proposals commit
   * together or not at all. Locks follow the order of submissions: the acting
   * account, the proposals in id order, the targeted roots, then the
   * microchanges.
   *
   * A microchange of an atomic group decides the whole group: its open members
   * apply in dependency order, all or none, or close together.
   *
   * Applying never overwrites a changed base: a plain `apply` then records the
   * conflict, commits it and answers 409, and only `apply_rebased`, confirming
   * the root's current version, applies over the new base.
   */
  async decide(user: User, changeId: string, input: DecisionInput): Promise<LoadedDecision[]> {
    const outcome = await this.dataSource.transaction(async (manager): Promise<Outcome> => {
      // Shared, so a concurrent role change or suspension waits until this decision commits.
      const actor = await lockContributor(manager, user.id);
      const located = await findSubmittedChange(manager, changeId);
      checkPermission(actor, located, input.action);
      checkInput(input);

      const members = await groupOf(manager, located);
      // Applying a field can resolve competing microchanges of other submissions, so their proposals are locked too.
      const competingProposalIds: string[] = [];
      for (const member of members.filter(({ operation }) => operation === 'set_fields')) {
        competingProposalIds.push(...(await findCompetingProposalIds(manager, member)));
      }
      const proposalIds = [...new Set([located.proposalId, ...competingProposalIds])].sort();
      const proposals = new Map<string, ChangeProposal>();
      for (const id of proposalIds) {
        proposals.set(id, await manager.findOneOrFail(ChangeProposal, { where: { id }, lock: { mode: 'pessimistic_write' } }));
      }
      const roots = await lockTargetedRoots(manager, members);
      const locked = await manager.find(ProposalChange, {
        where: { id: In(members.map(({ id }) => id)) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const change = locked.find(({ id }) => id === changeId)!;
      if (!OPEN_STATUSES.includes(change.status)) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'change_resolved', detail: `The microchange is already ${change.status}; a terminal decision is never reopened` },
        ]);
      }
      const open = locked.filter(({ status }) => OPEN_STATUSES.includes(status)).sort((a, b) => a.position - b.position);
      const context: DecisionContext = {
        manager,
        actor,
        input,
        proposals,
        versionsBefore: new Map([...roots].map(([id, root]) => [id, root.currentVersion])),
        now: this.clock.now(),
      };

      const outcome = input.action === 'reject' || input.action === 'withdraw_change' ? await closeTogether(context, open) : await applyAll(context, open);
      await closeIfSettled(manager, change.proposalId, context.now);
      return outcome;
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

/** Staff decide; the author of a microchange may only withdraw it. */
function checkPermission(actor: User, change: ProposalChange, action: ManualDecisionAction): void {
  if (isStaff(actor)) return;
  if (action === 'withdraw_change') {
    if (change.proposal!.authorId === actor.id) return;
    throw new JsonApiException(HttpStatus.FORBIDDEN, [
      { code: 'not_change_author', detail: 'Only the author of the microchange and staff withdraw it' },
    ]);
  }
  throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'staff_required', detail: 'Only moderators and administrators decide microchanges' }]);
}

/** The microchange and the other members of its atomic group, if it has one. */
async function groupOf(manager: EntityManager, change: ProposalChange): Promise<ProposalChange[]> {
  if (change.atomicGroupId === null) return [change];
  return manager.find(ProposalChange, { where: { proposalId: change.proposalId, atomicGroupId: change.atomicGroupId } });
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

/** Reads a microchange's target as it is now. A row or root its key names that is not created yet holds nothing. */
async function observe(manager: EntityManager, change: ProposalChange): Promise<Observation> {
  const root = await manager.findOneByOrFail(EditorialEntity, { id: change.entityId });
  const definition = findOperation(root.entityType, change.operation, change.targetPath, change.payloadSchemaVersion)!;
  const value = (change.proposedValue as { value?: unknown }).value;
  const key = change.targetKey === null ? null : (await resolveKey(manager, root, change.targetKey)).key;
  const current = change.targetKey !== null && key === null ? ABSENT : await definition.read(manager, root, key, value);
  return { root, definition, key, current };
}

function decisionOf(
  change: ProposalChange,
  { root, current }: Pick<Observation, 'root' | 'current'>,
  action: DecisionAction,
  resultingStatus: ChangeStatus,
  actorId: number | null,
  reason: string | null,
  now: Date,
): ChangeDecision {
  return {
    id: randomUUID(),
    changeId: change.id,
    actorId,
    action,
    previousStatus: change.status,
    resultingStatus,
    reason,
    observedVersion: root.currentVersion,
    observedValue: current,
    decidedAt: now,
  };
}

/** Records a decision and moves its microchange to the resulting state. */
async function recordDecision(manager: EntityManager, decision: ChangeDecision): Promise<void> {
  await manager.insert(ChangeDecision, decision);
  const open = OPEN_STATUSES.includes(decision.resultingStatus);
  await manager.update(ProposalChange, { id: decision.changeId }, { status: decision.resultingStatus, resolvedAt: open ? null : decision.decidedAt });
}

/** Rejects or withdraws the open members together, then blocks what depended on them. */
async function closeTogether(context: DecisionContext, open: ProposalChange[]): Promise<Outcome> {
  const { manager, actor, input, now } = context;
  const [action, resultingStatus] = input.action === 'reject' ? (['reject', 'rejected'] as const) : (['withdraw_change', 'withdrawn'] as const);
  const decisions: ChangeDecision[] = [];
  for (const change of open) {
    const decision = decisionOf(change, await observe(manager, change), action, resultingStatus, actor.id, input.reason || null, now);
    await recordDecision(manager, decision);
    decisions.push(decision);
  }
  await blockDependents(manager, open.map((change) => ({ ...change, status: resultingStatus })), now);
  return { decisions: await loadDecisions(manager, decisions.map(({ id }) => id)), conflict: null };
}

/**
 * Blocks, with automatic decisions, the open microchanges that depend on a
 * failed one, and the open members of their atomic groups, then what depends
 * on those in turn. Dependencies never leave a proposal, whose lock the
 * decision already holds.
 */
async function blockDependents(manager: EntityManager, failed: ProposalChange[], now: Date): Promise<void> {
  let frontier = failed;
  while (frontier.length > 0) {
    const causes = new Map(frontier.map((change) => [change.id, change]));
    const dependencies = await manager.findBy(ChangeDependency, { dependsOnChangeId: In([...causes.keys()]) });
    const dependents = await openChanges(manager, [...new Set(dependencies.map(({ changeId }) => changeId))]);
    const blocked = new Map<string, string>();
    for (const dependent of dependents) {
      const cause = causes.get(dependencies.find(({ changeId, dependsOnChangeId }) => changeId === dependent.id && causes.has(dependsOnChangeId))!.dependsOnChangeId)!;
      blocked.set(dependent.id, `El microcambio ${cause.id}, del que depende, quedó ${cause.status}`);
      if (dependent.atomicGroupId === null) continue;
      const mates = await manager.findBy(ProposalChange, {
        proposalId: dependent.proposalId,
        atomicGroupId: dependent.atomicGroupId,
        status: In(OPEN_STATUSES),
        id: Not(dependent.id),
      });
      for (const mate of mates) {
        if (!blocked.has(mate.id)) blocked.set(mate.id, `El microcambio ${dependent.id}, de su grupo atómico, quedó blocked`);
      }
    }
    const changes = await openChanges(manager, [...blocked.keys()]);
    for (const change of changes) {
      await recordDecision(manager, decisionOf(change, await observe(manager, change), 'block_dependency', 'blocked', null, blocked.get(change.id)!, now));
    }
    frontier = changes.map((change) => ({ ...change, status: 'blocked' as const }));
  }
}

async function openChanges(manager: EntityManager, ids: string[]): Promise<ProposalChange[]> {
  if (ids.length === 0) return [];
  return manager.find(ProposalChange, { where: { id: In(ids), status: In(OPEN_STATUSES) }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
}

/**
 * Applies the open members in dependency order, all or none. Prerequisites
 * outside them must hold their result already. A member in conflict undoes
 * the others, which stay pending, and its conflict is recorded instead.
 */
async function applyAll(context: DecisionContext, open: ProposalChange[]): Promise<Outcome> {
  const { manager, input } = context;
  const dependencies = await manager.findBy(ChangeDependency, { changeId: In(open.map(({ id }) => id)) });
  await checkDependencies(manager, open, dependencies);

  const decisions: ChangeDecision[] = [];
  try {
    // A savepoint, so a conflict found after some members applied undoes them and still records the conflict.
    await manager.transaction(async (savepoint) => {
      for (const change of inDependencyOrder(open, dependencies)) {
        const dependsOn = dependencies.filter(({ changeId }) => changeId === change.id).map(({ dependsOnChangeId }) => dependsOnChangeId);
        const step = await applyOne({ ...context, manager: savepoint }, change, dependsOn);
        if ('conflict' in step) throw new GroupConflict(step.conflict.change, step.conflict.reason);
        decisions.push(step.decision);
      }
      if (input.action === 'apply_rebased' && !decisions.some(({ action }) => action === 'apply_rebased')) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'base_unchanged', detail: 'The base of the microchange did not change; apply it without rebasing' },
        ]);
      }
    });
  } catch (error) {
    if (!(error instanceof GroupConflict)) throw error;
    const decision = decisionOf(error.change, await observe(manager, error.change), 'mark_conflict', 'conflicted', null, error.reason, context.now);
    await recordDecision(manager, decision);
    return { decisions: await loadDecisions(manager, [decision.id]), conflict: decision };
  }
  return { decisions: await loadDecisions(manager, decisions.map(({ id }) => id)), conflict: null };
}

/**
 * Decides one member on the state the members before it left: satisfied if
 * its result exists, a conflict if its base changed and the action does not
 * confirm the new one, applied otherwise.
 */
async function applyOne(context: DecisionContext, change: ProposalChange, dependsOn: string[]): Promise<Step> {
  const { manager, actor, input, proposals, versionsBefore, now } = context;
  const observation = await observe(manager, change);
  const { root, definition, key, current } = observation;
  // The payload and its references are checked again on the state this transaction sees.
  const errors = await revalidateChange(manager, proposals.get(change.proposalId)!, change, root, 'decision');
  if (errors.length > 0) throw invalid(errors);
  if (change.targetKey !== null && key === null) {
    throw new JsonApiException(HttpStatus.CONFLICT, [
      { code: 'reference_unresolved', detail: 'A row or root the key names has no result to translate it to; reject or withdraw the microchange' },
    ]);
  }

  const value = (change.proposedValue as { value?: unknown }).value;
  // Rows are compared by their keys and the root's constraints, never as a whole list; prerequisites by what they left.
  const clashes = [...((await definition.constraintProblems?.(manager, root, key, value)) ?? []), ...(await brokenPostconditions(manager, dependsOn))];
  const conflicted = change.status === 'conflicted' || clashes.length > 0 || (await baseChanged(manager, change, current, key, dependsOn));
  if (change.operation !== 'create_entity' && isDeepStrictEqual(current, change.proposedValue)) {
    // The result already exists: it closes without a write or a new version.
    const decision = decisionOf(change, observation, 'mark_satisfied', 'satisfied', null, null, now);
    await recordDecision(manager, decision);
    return { decision };
  }
  if (input.action === 'apply' && conflicted) {
    if (change.status === 'conflicted') throw baseChangedError(root.currentVersion, current);
    return { conflict: { change, reason: clashes[0] ?? `La base de ${change.targetPath} cambió después de la versión ${change.baseVersion} de la ficha` } };
  }
  const rebased = input.action === 'apply_rebased' && conflicted;
  if (rebased) {
    // A modification after the confirmation was given needs a new look, not the stale confirmation.
    if (input.confirmedVersion !== versionsBefore.get(root.id)) throw staleConfirmationError(versionsBefore.get(root.id)!, current);
    // A new base is confirmed; the root's constraints never are.
    if (clashes.length > 0) throw new JsonApiException(HttpStatus.CONFLICT, clashes.map((detail) => ({ code: 'constraint_violated', detail })));
  }
  const decision = decisionOf(change, observation, rebased ? 'apply_rebased' : 'apply', 'applied', actor.id, input.reason || null, now);
  const version = await applyChange(manager, definition, root, change, key, decision, now);
  await manager.update(ProposalChange, { id: change.id }, { status: 'applied', resolvedAt: now });
  if (change.operation === 'set_fields') await settleCompetingChanges(manager, change, version, proposals, now);
  return { decision };
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
 * The prerequisites of the microchanges being applied, besides those applied
 * with them, must already hold their result: the rows and roots their keys
 * name exist only then.
 */
async function checkDependencies(manager: EntityManager, applying: ProposalChange[], dependencies: ChangeDependency[]): Promise<void> {
  const ids = new Set(applying.map(({ id }) => id));
  const outside = [...new Set(dependencies.map(({ dependsOnChangeId }) => dependsOnChangeId).filter((id) => !ids.has(id)))];
  if (outside.length === 0) return;
  const unresolved = await manager.find(ProposalChange, { where: { id: In(outside), status: Not(In(FULFILLED_STATUSES)) }, order: { id: 'ASC' } });
  if (unresolved.length > 0) {
    throw new JsonApiException(HttpStatus.CONFLICT, [
      { code: 'dependency_unresolved', detail: 'Apply the microchanges this one depends on first', meta: { dependsOn: unresolved.map(({ id }) => id) } },
    ]);
  }
}

/**
 * What applied prerequisites left that no longer holds: an applied dependency
 * only unblocks while its result is still there, not because of its history.
 * A creation needs its root still published; an inserted or updated row, to
 * still exist.
 */
async function brokenPostconditions(manager: EntityManager, dependsOn: string[]): Promise<string[]> {
  if (dependsOn.length === 0) return [];
  const prerequisites = await manager.find(ProposalChange, { where: { id: In(dependsOn), status: 'applied' }, order: { id: 'ASC' } });
  const broken: string[] = [];
  for (const prerequisite of prerequisites) {
    const root = await manager.findOneByOrFail(EditorialEntity, { id: prerequisite.entityId });
    if (prerequisite.operation === 'create_entity' && root.publicationStatus !== 'published') {
      broken.push(`La ficha que publicó el microcambio ${prerequisite.id}, del que depende, ya no está publicada`);
    }
    if (prerequisite.operation === 'add_relation' || prerequisite.operation === 'update_relation') {
      const revision = await manager.findOneByOrFail(EntityRevision, { changeId: prerequisite.id });
      // A removal of the same relation reads its row by key, whatever value an insertion proposed.
      const removal = findOperation(root.entityType, 'remove_relation', prerequisite.targetPath, prerequisite.payloadSchemaVersion);
      if (removal && !(await removal.read(manager, root, revision.resultKey as RowKey, null)).exists) {
        broken.push(`La fila que escribió el microcambio ${prerequisite.id}, del que depende, ya no existe`);
      }
    }
  }
  return broken;
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
    const reason = satisfied ? null : `La versión ${version} de la ficha cambió ${applied.targetPath}, la base de este microcambio`;
    await recordDecision(manager, decisionOf(competitor, { root, current }, satisfied ? 'mark_satisfied' : 'mark_conflict', resultingStatus, null, reason, now));
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
