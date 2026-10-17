import { EntityManager } from 'typeorm';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';
import { ProposalChange } from './entities/proposal-change.entity';
import { RowKey } from './operation-registry';

/*
 * References inside a target key. A member names a dependent row by its
 * integer primary key or, before the row exists, by the insertion of the same
 * proposal that creates it: `{"change_id": …}`. A root is always named by its
 * editorial UUID, `{"entity_id": …}`, because its domain ids are not public.
 * A reference to something not created yet makes the microchange depend on
 * that creation. The submitted references never change: the server translates
 * them to the domain's keys each time it applies.
 */

type KeyMember = number | { change_id: string } | { entity_id: string };

export interface ReferenceProblem {
  code: string;
  detail: string;
  member: string;
}

type ReferencingChange = Pick<ProposalChange, 'id' | 'proposalId' | 'entityId' | 'targetPath'> & { targetKey: object };

/** The domain id of each root type a target key can name, once its creation is applied. */
const ROOT_IDS: Partial<Record<EditorialEntityType, (manager: EntityManager, entityId: string) => Promise<number | null>>> = {
  identity: identityIdOf,
};

/**
 * Checks the references of a valid target key and returns the microchanges of
 * the proposal they make it depend on. A row not created yet is an insertion
 * of the same relation on the same root; a root is the microchange's own, and
 * a reservation is named only inside the proposal that creates it.
 */
export async function checkReferences(
  manager: EntityManager,
  change: ReferencingChange,
  root: EditorialEntity,
): Promise<{ problems: ReferenceProblem[]; dependsOn: string[] }> {
  const problems: ReferenceProblem[] = [];
  const dependsOn: string[] = [];
  for (const [name, member] of members(change.targetKey)) {
    const at = `targetKey/${name}`;
    if (typeof member === 'number') continue;
    if ('change_id' in member) {
      const insertion = await manager.findOneBy(ProposalChange, { id: member.change_id.toLowerCase(), proposalId: change.proposalId });
      const valid =
        insertion &&
        insertion.id !== change.id &&
        insertion.operation === 'add_relation' &&
        insertion.entityId === change.entityId &&
        insertion.targetPath === change.targetPath;
      if (!valid) {
        problems.push({ code: 'invalid_reference', detail: `${at} must name an insertion of the same relation in this proposal`, member: at });
      } else {
        dependsOn.push(insertion.id);
      }
      continue;
    }
    if (member.entity_id.toLowerCase() !== change.entityId) {
      problems.push({ code: 'invalid_reference', detail: `${at} must name the root of the microchange`, member: at });
      continue;
    }
    if (root.publicationStatus === 'reserved') {
      const creation = await manager.findOneBy(ProposalChange, { proposalId: change.proposalId, entityId: root.id, operation: 'create_entity' });
      if (!creation) {
        problems.push({ code: 'invalid_reference', detail: `${at} names a reservation this proposal does not create`, member: at });
      } else {
        dependsOn.push(creation.id);
      }
    }
  }
  return { problems, dependsOn };
}

/**
 * A valid target key translated to the domain's keys: an insertion's row by
 * the key its revision kept, a root by its domain id. `key` is null while
 * something it names is not created yet; `pendingInsertions` are the
 * insertions among those.
 */
export async function resolveKey(
  manager: EntityManager,
  root: EditorialEntity,
  targetKey: object,
): Promise<{ key: RowKey | null; pendingInsertions: string[] }> {
  const key: RowKey = {};
  const pendingInsertions: string[] = [];
  let complete = true;
  for (const [name, member] of members(targetKey)) {
    let resolved: number | null;
    if (typeof member === 'number') {
      resolved = member;
    } else if ('change_id' in member) {
      const revision = await manager.findOneBy(EntityRevision, { changeId: member.change_id.toLowerCase() });
      resolved = ((revision?.resultKey as RowKey | null) ?? {})[name] ?? null;
      if (resolved === null) pendingInsertions.push(member.change_id.toLowerCase());
    } else {
      resolved = await ROOT_IDS[root.entityType]!(manager, member.entity_id.toLowerCase());
    }
    if (resolved === null) complete = false;
    else key[name] = resolved;
  }
  return { key: complete ? key : null, pendingInsertions };
}

/**
 * A target key as it is stored: the UUIDs of its references in lower case, so
 * equal keys compare equal however their author spelled them.
 */
export function normalizeKey(targetKey: unknown): unknown {
  if (typeof targetKey !== 'object' || targetKey === null || Array.isArray(targetKey)) return targetKey;
  return Object.fromEntries(
    Object.entries(targetKey).map(([name, member]) => {
      if (typeof member !== 'object' || member === null) return [name, member];
      return [name, Object.fromEntries(Object.entries(member).map(([kind, id]) => [kind, typeof id === 'string' ? id.toLowerCase() : id]))];
    }),
  );
}

/** Whether a valid target key names a root, as only a reservation's own creation can let it be changed. */
export function namesRoot(targetKey: object | null): boolean {
  return members(targetKey ?? {}).some(([, member]) => typeof member === 'object' && 'entity_id' in member);
}

function members(targetKey: object): [string, KeyMember][] {
  return Object.entries(targetKey);
}
