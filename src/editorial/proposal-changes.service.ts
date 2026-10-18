import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { withLinks } from './change-links.service';
import { dependencyCycle, hasDependencyCycle } from './dependency-graph';
import { changeNotFound, invalid } from './editorial-access';
import { lockOwnDraft, touchDraft } from './drafts';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ChangeOperation, ProposalChange, ValueEnvelope } from './entities/proposal-change.entity';
import { ChangeDependency, ChangeSource } from './entities/proposal-links.entity';
import {
  ABSENT,
  OperationDefinition,
  RootReference,
  VOCABULARIES,
  VocabularyReference,
  findOperation,
  isRegistered,
  validatePayload,
  validateTargetKey,
} from './operation-registry';
import { checkReferences, namesRoot, normalizeKey, resolveKey } from './row-references';

export interface NewChange {
  entityId: string;
  operation: string;
  targetPath: string;
  targetKey?: unknown;
  payloadSchemaVersion?: number;
  proposedValue: unknown;
  atomicGroupId?: string | null;
  position?: number;
}

export type ChangeUpdate = Partial<Pick<NewChange, 'proposedValue' | 'payloadSchemaVersion' | 'atomicGroupId' | 'position'>>;

/**
 * A rule a microchange breaks. `member` names what is wrong: an attribute, a
 * path inside `proposedValue` (`proposedValue/value/...`) or `entity`.
 */
interface ChangeProblem {
  code: string;
  detail: string;
  member: string;
}

/** Microchanges of a draft. */
@Injectable()
export class ProposalChangesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  add(user: User, proposalId: string, input: NewChange): Promise<ProposalChange> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      // Shared, so the base's version and value are read from the same state.
      const entity = await manager.findOne(EditorialEntity, { where: { id: input.entityId.toLowerCase() }, lock: { mode: 'pessimistic_read' } });
      const change = {
        id: randomUUID(),
        proposalId,
        entityId: input.entityId.toLowerCase(),
        operation: input.operation,
        targetPath: input.targetPath,
        // targetKey and proposedValue are checked by changeProblems before anything is written.
        targetKey: normalizeKey(input.targetKey ?? null) as object | null,
        payloadSchemaVersion: input.payloadSchemaVersion ?? 1,
        proposedValue: input.proposedValue as ValueEnvelope,
        atomicGroupId: input.atomicGroupId ?? null,
        position: input.position ?? (await nextPosition(manager, proposalId)),
      };
      const problems = await changeProblems(manager, proposal, change, entity);
      if (problems.length > 0) throw invalid(problems.map(asBodyError));
      await checkPosition(manager, proposalId, change.id, change.position);

      const now = this.clock.now();
      await manager.insert(ProposalChange, {
        ...change,
        operation: change.operation as ChangeOperation,
        // The target as the author sees it now. Creations start from absence at version 0, the only base a reservation has.
        baseVersion: entity!.currentVersion,
        baseValue: await readBase(manager, entity!, change),
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
      });
      await touchDraft(manager, proposal, now);
      return (await withLinks(manager, [await manager.findOneByOrFail(ProposalChange, { id: change.id })]))[0];
    });
  }

  update(user: User, proposalId: string, changeId: string, input: ChangeUpdate): Promise<ProposalChange> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      const current = await findChange(manager, proposalId, changeId);
      const change = {
        ...current,
        ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      } as ProposalChange;
      const entity = await manager.findOneBy(EditorialEntity, { id: change.entityId });
      const problems = await changeProblems(manager, proposal, change, entity);
      if (problems.length > 0) throw invalid(problems.map(asBodyError));
      await checkPosition(manager, proposalId, change.id, change.position);

      await manager.update(
        ProposalChange,
        { id: changeId },
        {
          proposedValue: change.proposedValue,
          payloadSchemaVersion: change.payloadSchemaVersion,
          atomicGroupId: change.atomicGroupId,
          position: change.position,
          // An insertion's base is the row its value would collide with, so it follows the value.
          ...(change.operation === 'add_relation' ? { baseValue: await readBase(manager, entity!, change) } : {}),
        },
      );
      // Joining or leaving an atomic group changes the collapsed dependency graph.
      if (change.atomicGroupId !== current.atomicGroupId && (await hasDependencyCycle(manager, proposalId))) {
        throw invalid([dependencyCycle('/data/attributes/atomicGroupId')]);
      }
      // Changes to the row an insertion will create start from the value it proposes.
      if (change.operation === 'add_relation') {
        await manager
          .createQueryBuilder()
          .update(ProposalChange)
          .set({ baseValue: change.proposedValue })
          .where('proposal_id = :proposalId', { proposalId })
          .andWhere(`jsonb_path_exists(target_key, '$.* ? (@.change_id == $id)', jsonb_build_object('id', :changeId::text))`, { changeId })
          .execute();
      }
      await touchDraft(manager, proposal, this.clock.now());
      return (await withLinks(manager, [await manager.findOneByOrFail(ProposalChange, { id: changeId })]))[0];
    });
  }

  remove(user: User, proposalId: string, changeId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const proposal = await lockOwnDraft(manager, user, proposalId);
      await findChange(manager, proposalId, changeId);
      await manager.delete(ChangeSource, { changeId });
      await manager.delete(ChangeDependency, [{ changeId }, { dependsOnChangeId: changeId }]);
      await manager.delete(ProposalChange, { id: changeId });
      await touchDraft(manager, proposal, this.clock.now());
    });
  }
}

/**
 * Locks, in a consistent order, the roots the given microchanges target, and
 * shares the lock of the other roots their values refer to, so none of those
 * is withdrawn meanwhile. Returns the targeted roots.
 */
export async function lockTargetedRoots(manager: EntityManager, changes: ProposalChange[]): Promise<Map<string, EditorialEntity>> {
  const targeted = new Set(changes.map(({ entityId }) => entityId));
  const referenced = new Set<string>();
  for (const change of changes) {
    for (const { entityId } of await rootReferencesOf(manager, change)) if (!targeted.has(entityId)) referenced.add(entityId);
  }
  const roots = new Map<string, EditorialEntity>();
  for (const id of [...targeted, ...referenced].sort()) {
    const mode = targeted.has(id) ? 'pessimistic_write' : 'pessimistic_read';
    const root = await manager.findOne(EditorialEntity, { where: { id }, lock: { mode } });
    if (root && targeted.has(id)) roots.set(id, root);
  }
  return roots;
}

/** The other roots a microchange's value refers to, when its operation and value are valid. */
async function rootReferencesOf(manager: EntityManager, change: Pick<ProposalChange, 'entityId' | 'operation' | 'targetPath' | 'payloadSchemaVersion' | 'proposedValue'>): Promise<RootReference[]> {
  const root = await manager.findOneBy(EditorialEntity, { id: change.entityId });
  const definition = root && findOperation(root.entityType, change.operation, change.targetPath, change.payloadSchemaVersion);
  if (!definition?.rootReferences || validatePayload(definition, change.proposedValue).length > 0) return [];
  return definition.rootReferences((change.proposedValue as { value: unknown }).value);
}

/**
 * Records the dependencies the references of a submitted microchange imply:
 * on the insertion that creates a row its key names, and on the creation of a
 * reservation its key or its value names. Its references were checked already.
 */
export async function recordImpliedDependencies(manager: EntityManager, change: ProposalChange, root: EditorialEntity): Promise<void> {
  const dependsOn = change.targetKey === null ? [] : (await checkReferences(manager, { ...change, targetKey: change.targetKey }, root)).dependsOn;
  for (const reference of await rootReferencesOf(manager, change)) {
    const creation = await manager.findOneBy(ProposalChange, { proposalId: change.proposalId, entityId: reference.entityId, operation: 'create_entity' });
    if (creation) dependsOn.push(creation.id);
  }
  for (const dependsOnChangeId of dependsOn) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(ChangeDependency)
      .values({ changeId: change.id, dependsOnChangeId, proposalId: change.proposalId })
      .orIgnore()
      .execute();
  }
}

/** Checks a microchange again at submission, reporting each problem with the microchange it belongs to. */
export async function revalidateChange(
  manager: EntityManager,
  proposal: ChangeProposal,
  change: ProposalChange,
  entity: EditorialEntity | undefined,
  stage: Stage = 'submission',
): Promise<JsonApiErrorInput[]> {
  const problems = await changeProblems(manager, proposal, change, entity ?? null, stage);
  return problems.map(({ code, detail, member }) => ({ code, detail, meta: { changeId: change.id, member } }));
}

/**
 * The rules on the root's other data that an applied microchange breaks, such
 * as a dissolution before the founding, on the state its whole atomic group
 * left. Reported with the microchange each problem belongs to.
 */
export async function finalStateProblems(manager: EntityManager, change: ProposalChange, root: EditorialEntity): Promise<JsonApiErrorInput[]> {
  const definition = findOperation(root.entityType, change.operation, change.targetPath, change.payloadSchemaVersion)!;
  const problems = (await definition.targetProblems?.(manager, root, (change.proposedValue as { value: unknown }).value)) ?? [];
  return problems.map(({ code, detail, member }) => ({ code, detail, meta: { changeId: change.id, member } }));
}

/**
 * When a microchange is checked. A decision finds a row gone or a constraint
 * broken as a conflict or a satisfied result, not as an invalid microchange,
 * and checks the rules on the root's other data only on the state its whole
 * atomic group leaves: see `finalStateProblems`.
 */
type Stage = 'draft' | 'submission' | 'decision';

type ChangeFields = Pick<
  ProposalChange,
  'id' | 'proposalId' | 'entityId' | 'targetPath' | 'targetKey' | 'payloadSchemaVersion' | 'proposedValue' | 'atomicGroupId'
> & { operation: string };

/**
 * The rules of a microchange of a draft: an operation of the registry for its
 * root's type, a target that root's author may propose on, no overlapping write
 * in the same proposal and a valid payload.
 */
async function changeProblems(
  manager: EntityManager,
  proposal: ChangeProposal,
  change: ChangeFields,
  entity: EditorialEntity | null,
  stage: Stage = 'draft',
): Promise<ChangeProblem[]> {
  // A reservation is private to its creator, so for anyone else it does not exist.
  if (!entity || (entity.publicationStatus === 'reserved' && entity.createdById !== proposal.authorId)) {
    return [{ code: 'editorial_entity_not_found', detail: 'The editorial entity does not exist', member: 'entity' }];
  }
  const definition = findOperation(entity.entityType, change.operation, change.targetPath, change.payloadSchemaVersion);
  if (!definition) return [unregistered(entity, change)];
  const keyProblems = await targetKeyProblems(manager, definition, change, entity);
  if (keyProblems.length > 0) return keyProblems;

  const overlap = await withdrawalOverlap(manager, change);
  if (overlap.length > 0) return overlap;
  const problems: ChangeProblem[] = [];
  if (definition.operation === 'create_entity') problems.push(...(await creationProblems(manager, change, entity)));
  if (definition.operation === 'withdraw_entity') {
    const targetProblems = withdrawalProblems(entity, stage);
    if (targetProblems.length > 0) return targetProblems;
  }
  if (definition.operation === 'set_fields') {
    const targetProblems = await fieldChangeProblems(manager, change, entity);
    if (targetProblems.length > 0) return targetProblems;
  }
  if (isRelationOperation(definition.operation)) {
    const targetProblems = await relationChangeProblems(manager, definition, change, entity, stage);
    if (targetProblems.length > 0) return targetProblems;
  }
  problems.push(...(await payloadProblems(manager, definition, change.proposedValue)));
  if (problems.length === 0) problems.push(...(await rootReferenceProblems(manager, proposal, definition, change.proposedValue)));
  // A member of an atomic group is judged with the rest of its group, which only a decision applies.
  if (problems.length === 0 && definition.targetProblems && stage !== 'decision' && change.atomicGroupId === null) {
    problems.push(...(await definition.targetProblems(manager, entity, (change.proposedValue as { value: unknown }).value)));
  }
  return problems;
}

/**
 * A field change targets a published root, and no other microchange of the
 * proposal writes the same field. A reservation's fields are set by its
 * creation itself.
 */
async function fieldChangeProblems(manager: EntityManager, change: ChangeFields, entity: EditorialEntity): Promise<ChangeProblem[]> {
  if (entity.publicationStatus !== 'published') {
    return [{ code: 'entity_not_published', detail: 'Only a published root can change its fields', member: 'entity' }];
  }
  const overlapping = await manager.existsBy(ProposalChange, {
    proposalId: change.proposalId,
    entityId: entity.id,
    targetPath: change.targetPath,
    id: Not(change.id),
  });
  if (overlapping) {
    return [{ code: 'overlapping_change', detail: `This proposal already changes ${change.targetPath} of this root`, member: 'targetPath' }];
  }
  return [];
}

/**
 * A withdrawal targets a published root. A decision also finds it already
 * withdrawn, which satisfies it.
 */
function withdrawalProblems(entity: EditorialEntity, stage: Stage): ChangeProblem[] {
  if (entity.publicationStatus === 'published' || (stage === 'decision' && entity.publicationStatus === 'withdrawn')) return [];
  return [{ code: 'entity_not_published', detail: 'Only a published root can be withdrawn', member: 'entity' }];
}

/**
 * A withdrawal writes the whole root's editorial state, so it overlaps every
 * other microchange of the proposal on the same root.
 */
async function withdrawalOverlap(manager: EntityManager, change: ChangeFields): Promise<ChangeProblem[]> {
  const others = manager
    .createQueryBuilder(ProposalChange, 'other')
    .where('other.proposal_id = :proposalId', { proposalId: change.proposalId })
    .andWhere('other.entity_id = :entityId', { entityId: change.entityId })
    .andWhere('other.id <> :id', { id: change.id });
  if (change.operation !== 'withdraw_entity') others.andWhere(`other.operation = 'withdraw_entity'`);
  if (!(await others.getExists())) return [];
  return [{ code: 'overlapping_change', detail: 'A withdrawal of a root cannot share a proposal with other microchanges on it', member: 'entity' }];
}

/**
 * A target key matches the operation's schema, or is null when the operation
 * selects no row, and its references and vocabulary entries exist.
 */
async function targetKeyProblems(
  manager: EntityManager,
  definition: OperationDefinition,
  change: ChangeFields,
  entity: EditorialEntity,
): Promise<ChangeProblem[]> {
  if (definition.targetKeySchema === null) {
    if (change.targetKey === null) return [];
    return [{ code: 'invalid_target_key', detail: 'This operation selects no row; targetKey must be null', member: 'targetKey' }];
  }
  const invalidKey = validateTargetKey(definition, change.targetKey).map(({ path, detail }) => ({
    code: 'invalid_target_key',
    detail: `targetKey${path} ${detail}`,
    member: `targetKey${path}`,
  }));
  if (invalidKey.length > 0) return invalidKey;
  const { problems } = await checkReferences(manager, { ...change, targetKey: change.targetKey! }, entity);
  return [...problems, ...(await vocabularyProblems(manager, definition.keyReferences?.(change.targetKey!) ?? [], 'targetKey'))];
}

/**
 * A relation change targets a published root, or a reservation its key names
 * and so depends on creating. No other microchange of the proposal selects the
 * same row, and an existing row it updates or removes belongs to the root.
 */
async function relationChangeProblems(
  manager: EntityManager,
  definition: OperationDefinition,
  change: ChangeFields,
  entity: EditorialEntity,
  stage: Stage,
): Promise<ChangeProblem[]> {
  // A reservation's own creation may name it; a withdrawn root accepts no new relation at all.
  if (entity.publicationStatus === 'withdrawn' || (entity.publicationStatus === 'reserved' && !namesRoot(change.targetKey))) {
    return [{ code: 'entity_not_published', detail: 'Only a published root can change its relations', member: 'entity' }];
  }
  const others = manager
    .createQueryBuilder(ProposalChange, 'other')
    .where('other.proposal_id = :proposalId', { proposalId: change.proposalId })
    .andWhere('other.entity_id = :entityId', { entityId: entity.id })
    .andWhere('other.target_path = :targetPath', { targetPath: change.targetPath })
    .andWhere('other.id <> :id', { id: change.id });
  // An insertion whose row has no key yet is told apart by the unique key of its value.
  const naturalKey = change.targetKey === null ? definition.naturalKey?.((change.proposedValue as { value?: unknown }).value) : undefined;
  if (change.targetKey !== null) {
    others.andWhere('other.target_key = :targetKey::jsonb', { targetKey: JSON.stringify(change.targetKey) });
  } else if (naturalKey) {
    others
      .andWhere(`other.operation = 'add_relation'`)
      .andWhere(`other.proposed_value -> 'value' @> :naturalKey::jsonb`, { naturalKey: JSON.stringify(naturalKey) });
  }
  if ((change.targetKey !== null || naturalKey) && (await others.getExists())) {
    const member = change.targetKey === null ? 'proposedValue/value' : 'targetKey';
    return [{ code: 'overlapping_change', detail: `This proposal already writes this row of ${change.targetPath}`, member }];
  }
  if (change.targetKey === null) return [];
  if (definition.operation !== 'add_relation' && stage !== 'decision') {
    const { key } = await resolveKey(manager, entity, change.targetKey);
    if (key && !(await definition.read(manager, entity, key, null)).exists) {
      return [{ code: 'relation_row_not_found', detail: `The root has no row of ${change.targetPath} with this key`, member: 'targetKey' }];
    }
  }
  return [];
}

export function isRelationOperation(operation: string): boolean {
  return operation === 'add_relation' || operation === 'update_relation' || operation === 'remove_relation';
}

/**
 * The base of a microchange: its target as the author sees it now. A row not
 * created yet is the one its insertion proposes, and a reservation holds no
 * row at all.
 */
async function readBase(manager: EntityManager, entity: EditorialEntity, change: ChangeFields): Promise<ValueEnvelope> {
  const definition = findOperation(entity.entityType, change.operation, change.targetPath, change.payloadSchemaVersion)!;
  const value = (change.proposedValue as { value?: unknown }).value;
  if (change.targetKey === null) return definition.read(manager, entity, null, value);
  const { key, pendingInsertions } = await resolveKey(manager, entity, change.targetKey);
  if (key) return definition.read(manager, entity, key, value);
  if (pendingInsertions.length > 0) return (await manager.findOneByOrFail(ProposalChange, { id: pendingInsertions[0] })).proposedValue;
  return ABSENT;
}

/** Names the first member of the selector that no registry entry for the root's type has. */
function unregistered(entity: EditorialEntity, change: ChangeFields): ChangeProblem {
  const problem = (member: string, value: unknown): ChangeProblem => ({
    code: 'unregistered_operation',
    detail: `${member} ${value} is not in the registry of operations for ${entity.entityType} (GET /v1/editorial-operations)`,
    member,
  });
  if (!isRegistered({ entityType: entity.entityType, operation: change.operation })) return problem('operation', change.operation);
  if (!isRegistered({ entityType: entity.entityType, operation: change.operation, targetPath: change.targetPath })) {
    return problem('targetPath', change.targetPath);
  }
  return problem('payloadSchemaVersion', change.payloadSchemaVersion);
}

/** A creation targets a reservation, once per proposal, and only the proposal that first submits it. */
async function creationProblems(manager: EntityManager, change: ChangeFields, entity: EditorialEntity): Promise<ChangeProblem[]> {
  if (entity.publicationStatus !== 'reserved') {
    return [{ code: 'entity_not_reserved', detail: 'Only a reserved root can be created', member: 'entity' }];
  }
  const problems: ChangeProblem[] = [];
  const overlapping = await manager.existsBy(ProposalChange, {
    proposalId: change.proposalId,
    entityId: entity.id,
    operation: 'create_entity',
    id: Not(change.id),
  });
  if (overlapping) {
    problems.push({ code: 'overlapping_change', detail: 'This proposal already creates this root', member: 'entity' });
  }
  const claimed = await manager
    .createQueryBuilder(ProposalChange, 'change')
    .innerJoin('change.proposal', 'proposal')
    .where('change.entity_id = :entityId', { entityId: entity.id })
    .andWhere('change.proposal_id <> :proposalId', { proposalId: change.proposalId })
    .andWhere(`proposal.status <> 'draft'`)
    .getExists();
  if (claimed) {
    problems.push({
      code: 'reservation_claimed',
      detail: 'Another submission already proposes this reservation; reserve a new root instead',
      member: 'entity',
    });
  }
  return problems;
}

async function payloadProblems(manager: EntityManager, definition: OperationDefinition, proposed: unknown): Promise<ChangeProblem[]> {
  const problems = validatePayload(definition, proposed).map(({ path, detail }) => ({
    code: 'invalid_payload',
    detail: `${path || 'proposedValue'} ${detail}`,
    member: `proposedValue${path}`,
  }));
  if (problems.length > 0) return problems;
  return vocabularyProblems(manager, definition.references((proposed as { value: unknown }).value), 'proposedValue');
}

/**
 * Each root a value refers to has the expected type and is published, or is a
 * reservation of the author that the same proposal creates. A relation never
 * points to a withdrawn entry.
 */
async function rootReferenceProblems(
  manager: EntityManager,
  proposal: ChangeProposal,
  definition: OperationDefinition,
  proposed: unknown,
): Promise<ChangeProblem[]> {
  const problems: ChangeProblem[] = [];
  for (const { entityType, entityId, path } of definition.rootReferences?.((proposed as { value: unknown }).value) ?? []) {
    const member = `proposedValue${path}`;
    const root = await manager.findOneBy(EditorialEntity, { id: entityId });
    // A reservation is private to its creator, so for anyone else it does not exist.
    if (!root || root.entityType !== entityType || (root.publicationStatus === 'reserved' && root.createdById !== proposal.authorId)) {
      problems.push({ code: 'invalid_reference', detail: `${member} must name a ${entityType} root`, member });
    } else if (root.publicationStatus === 'withdrawn') {
      problems.push({ code: 'entity_withdrawn', detail: `${member} names a withdrawn entry, which accepts no new relation`, member });
    } else if (
      root.publicationStatus === 'reserved' &&
      !(await manager.existsBy(ProposalChange, { proposalId: proposal.id, entityId: root.id, operation: 'create_entity' }))
    ) {
      problems.push({ code: 'invalid_reference', detail: `${member} names a reservation this proposal does not create`, member });
    }
  }
  return problems;
}

/** Each vocabulary entry referred to must exist; `member` is where the paths of the references start. */
async function vocabularyProblems(manager: EntityManager, references: VocabularyReference[], member: string): Promise<ChangeProblem[]> {
  const problems: ChangeProblem[] = [];
  for (const reference of references) {
    if (!(await manager.existsBy(VOCABULARIES[reference.vocabulary], { id: reference.id }))) {
      problems.push({
        code: 'unknown_vocabulary_entry',
        detail: `There is no entry ${reference.id} in ${reference.vocabulary}`,
        member: `${member}${reference.path}`,
      });
    }
  }
  return problems;
}

function asBodyError({ code, detail, member }: ChangeProblem): JsonApiErrorInput {
  const pointer = member === 'entity' ? '/data/relationships/entity/data/id' : `/data/attributes/${member}`;
  return { code, detail, source: { pointer } };
}

async function findChange(manager: EntityManager, proposalId: string, changeId: string): Promise<ProposalChange> {
  const change = await manager.findOneBy(ProposalChange, { id: changeId, proposalId });
  if (!change) throw changeNotFound();
  return change;
}

async function nextPosition(manager: EntityManager, proposalId: string): Promise<number> {
  const [{ next }] = await manager.query(
    'SELECT coalesce(max(position) + 1, 0)::int AS next FROM proposal_changes WHERE proposal_id = $1',
    [proposalId],
  );
  return next;
}

/** Positions order a proposal, so two microchanges never share one. */
async function checkPosition(manager: EntityManager, proposalId: string, changeId: string, position: number): Promise<void> {
  if (await manager.existsBy(ProposalChange, { proposalId, position, id: Not(changeId) })) {
    throw invalid([
      { code: 'position_taken', detail: 'Another microchange of this proposal has this position', source: { pointer: '/data/attributes/position' } },
    ]);
  }
}
