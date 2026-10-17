import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { Country } from '../vocabularies/entities/country.entity';
import { changeNotFound, invalid } from './editorial-access';
import { lockOwnDraft, touchDraft } from './drafts';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ChangeOperation, ProposalChange, ValueEnvelope } from './entities/proposal-change.entity';
import { ChangeDependency, ChangeSource } from './entities/proposal-links.entity';
import { ABSENT, OperationDefinition, findOperation, isRegistered, validatePayload } from './operation-registry';

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
      const entity = await manager.findOneBy(EditorialEntity, { id: input.entityId.toLowerCase() });
      const change = {
        id: randomUUID(),
        proposalId,
        entityId: input.entityId.toLowerCase(),
        operation: input.operation,
        targetPath: input.targetPath,
        // targetKey and proposedValue are checked by changeProblems before anything is written.
        targetKey: (input.targetKey ?? null) as object | null,
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
        // Creations start from absence at version 0, the only base a reservation has.
        baseVersion: entity!.currentVersion,
        baseValue: ABSENT,
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
      });
      await touchDraft(manager, proposal, now);
      return manager.findOneByOrFail(ProposalChange, { id: change.id });
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
        },
      );
      await touchDraft(manager, proposal, this.clock.now());
      return manager.findOneByOrFail(ProposalChange, { id: changeId });
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

/** Locks, in a consistent order, the roots the given microchanges target. */
export async function lockTargetedRoots(manager: EntityManager, changes: ProposalChange[]): Promise<Map<string, EditorialEntity>> {
  const ids = [...new Set(changes.map(({ entityId }) => entityId))].sort();
  const roots = new Map<string, EditorialEntity>();
  for (const id of ids) {
    const root = await manager.findOne(EditorialEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (root) roots.set(id, root);
  }
  return roots;
}

/** Checks a microchange again at submission, reporting each problem with the microchange it belongs to. */
export async function revalidateChange(
  manager: EntityManager,
  proposal: ChangeProposal,
  change: ProposalChange,
  entity: EditorialEntity | undefined,
): Promise<JsonApiErrorInput[]> {
  const problems = await changeProblems(manager, proposal, change, entity ?? null);
  return problems.map(({ code, detail, member }) => ({ code, detail, meta: { changeId: change.id, member } }));
}

type ChangeFields = Pick<
  ProposalChange,
  'id' | 'proposalId' | 'entityId' | 'targetPath' | 'targetKey' | 'payloadSchemaVersion' | 'proposedValue'
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
): Promise<ChangeProblem[]> {
  // A reservation is private to its creator, so for anyone else it does not exist.
  if (!entity || (entity.publicationStatus === 'reserved' && entity.createdById !== proposal.authorId)) {
    return [{ code: 'editorial_entity_not_found', detail: 'The editorial entity does not exist', member: 'entity' }];
  }
  const definition = findOperation(entity.entityType, change.operation, change.targetPath, change.payloadSchemaVersion);
  if (!definition) return [unregistered(entity, change)];
  if (change.targetKey !== null) {
    return [{ code: 'invalid_target_key', detail: 'This operation selects no row; targetKey must be null', member: 'targetKey' }];
  }

  const problems: ChangeProblem[] = [];
  if (definition.operation === 'create_entity') problems.push(...(await creationProblems(manager, change, entity)));
  problems.push(...(await payloadProblems(manager, definition, change.proposedValue)));
  return problems;
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

  for (const reference of definition.references((proposed as { value: unknown }).value)) {
    if (!(await manager.existsBy(VOCABULARIES[reference.vocabulary], { id: reference.id }))) {
      problems.push({
        code: 'unknown_vocabulary_entry',
        detail: `There is no entry ${reference.id} in ${reference.vocabulary}`,
        member: `proposedValue${reference.path}`,
      });
    }
  }
  return problems;
}

/** The entity behind each vocabulary a payload may refer to. */
const VOCABULARIES = { countries: Country } as const;

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
