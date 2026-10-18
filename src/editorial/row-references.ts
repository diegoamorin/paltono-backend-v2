import { EntityManager } from 'typeorm';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { eventIdOf, tourIdOf } from '../live-events/live-events';
import { recordingIdOf } from '../music/recordings';
import { releaseGroupIdOf, releaseIdOf } from '../music/releases';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';
import { ProposalChange } from './entities/proposal-change.entity';
import { OperationDefinition, RootReference, RowKey } from './operation-registry';

/*
 * References inside a target key. A member names a dependent row by its
 * integer primary key or, before the row exists, by the insertion of the same
 * proposal that creates it: `{"change_id": …}`. A root is always named by its
 * editorial UUID, `{"entity_id": …}`, because its domain ids are not public:
 * the microchange's own root or, in a member its operation declares (`keyRoots`),
 * another root, which is checked like a root its value names. A member its
 * operation declares in `keyRows` names a row of another relation of the same
 * root, such as the track of a track credit, by its id or by the insertion
 * that creates it.
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

/** What an operation declares about the members of its target key. */
export type KeyMembers = Pick<OperationDefinition, 'keyRoots' | 'keyRows'>;

/** The domain id of each root type a target key can name, once its creation is applied. */
const ROOT_IDS: Partial<Record<EditorialEntityType, (manager: EntityManager, entityId: string) => Promise<number | null>>> = {
  identity: identityIdOf,
  recording: recordingIdOf,
  release_group: releaseGroupIdOf,
  release: releaseIdOf,
  tour: tourIdOf,
  event: eventIdOf,
};

/**
 * Checks the references of a valid target key and returns the microchanges of
 * the proposal they make it depend on. A row not created yet is an insertion
 * on the same root of the same relation, or of the one a `keyRows` member
 * names; a root is the microchange's own, and a reservation is named only
 * inside the proposal that creates it.
 */
export async function checkReferences(
  manager: EntityManager,
  change: ReferencingChange,
  root: EditorialEntity,
  { keyRoots = {}, keyRows = {} }: KeyMembers = {},
): Promise<{ problems: ReferenceProblem[]; dependsOn: string[] }> {
  const problems: ReferenceProblem[] = [];
  const dependsOn: string[] = [];
  for (const [name, member] of members(change.targetKey)) {
    const at = `targetKey/${name}`;
    // Another root: see `checkRootReferences`.
    if (typeof member === 'number' || name in keyRoots) continue;
    if ('change_id' in member) {
      const insertion = await manager.findOneBy(ProposalChange, { id: member.change_id.toLowerCase(), proposalId: change.proposalId });
      const valid =
        insertion &&
        insertion.id !== change.id &&
        insertion.operation === 'add_relation' &&
        insertion.entityId === change.entityId &&
        insertion.targetPath === (keyRows[name]?.targetPath ?? change.targetPath);
      if (!valid) {
        const relation = keyRows[name] ? `of ${keyRows[name].targetPath} on the same root` : 'of the same relation';
        problems.push({ code: 'invalid_reference', detail: `${at} must name an insertion ${relation} in this proposal`, member: at });
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

/** The other roots the members of a valid target key name, as its operation declares them. */
export function keyRootReferences(keyRoots: KeyMembers['keyRoots'], targetKey: object | null): RootReference[] {
  if (!keyRoots || targetKey === null) return [];
  return Object.entries(keyRoots).flatMap(([name, { entityType }]) => {
    const member = (targetKey as Record<string, KeyMember | undefined>)[name];
    if (typeof member !== 'object' || member === null || !('entity_id' in member) || typeof member.entity_id !== 'string') return [];
    return [{ entityId: member.entity_id.toLowerCase(), entityType, path: `/${name}/entity_id`, within: 'targetKey' as const }];
  });
}

/**
 * Checks the roots a valid value or target key names besides the
 * microchange's own and returns the creations of the proposal they make it
 * depend on. Each one is a root of the expected type, published or reserved
 * and created by this same proposal; a withdrawn root accepts no new relation.
 * Paths are inside `proposedValue` or, when the reference says so, `targetKey`.
 */
export async function checkRootReferences(
  manager: EntityManager,
  change: Pick<ProposalChange, 'proposalId' | 'entityId'>,
  references: RootReference[],
): Promise<{ problems: ReferenceProblem[]; dependsOn: string[] }> {
  const problems: ReferenceProblem[] = [];
  const dependsOn: string[] = [];
  for (const reference of references) {
    const { entityId, entityType, path } = reference;
    const id = entityId.toLowerCase();
    const member = `${reference.within ?? 'proposedValue'}${path}`;
    if (id === change.entityId) {
      problems.push({ code: 'invalid_reference', detail: `${member} must name another root than the microchange's`, member });
      continue;
    }
    const referenced = await manager.findOneBy(EditorialEntity, { id });
    const creation =
      referenced?.publicationStatus === 'reserved'
        ? await manager.findOneBy(ProposalChange, { proposalId: change.proposalId, entityId: id, operation: 'create_entity' })
        : null;
    if (!referenced || referenced.entityType !== entityType || (referenced.publicationStatus === 'reserved' && !creation)) {
      const detail = `${member} names no published ${entityType} nor a reservation this proposal creates`;
      problems.push({ code: 'invalid_reference', detail, member });
    } else if (referenced.publicationStatus === 'withdrawn') {
      problems.push({ code: 'entity_withdrawn', detail: `${member} names a withdrawn root, which accepts no new relations`, member });
    } else if (creation) {
      dependsOn.push(creation.id);
    }
  }
  return { problems, dependsOn };
}

/** A proposed value as it is stored: the UUIDs of its references in lower case, like those of target keys. */
export function normalizeReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeReferences);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, member]) => [
      name,
      (name === 'entity_id' || name === 'change_id') && typeof member === 'string' ? member.toLowerCase() : normalizeReferences(member),
    ]),
  );
}

/**
 * A valid target key translated to the domain's keys: an insertion's row by
 * the key its revision kept, a root by its domain id. `key` is null while
 * something it names is not created yet; `pendingInsertions` are the
 * insertions of the same relation among those, whose row the key selects.
 */
export async function resolveKey(
  manager: EntityManager,
  root: EditorialEntity,
  targetKey: object,
  { keyRoots = {}, keyRows = {} }: KeyMembers = {},
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
      resolved = ((revision?.resultKey as RowKey | null) ?? {})[keyRows[name]?.resultMember ?? name] ?? null;
      if (resolved === null && !(name in keyRows)) pendingInsertions.push(member.change_id.toLowerCase());
    } else if (name in keyRoots) {
      resolved = await keyRoots[name].idOf(manager, member.entity_id.toLowerCase());
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

/**
 * Whether a valid target key names the microchange's root, or a row an
 * insertion of the proposal creates on it, as only a reservation's own
 * creation can let it be changed. Another root a `keyRoots` member names does
 * not count.
 */
export function namesRoot(targetKey: object | null, { keyRoots = {} }: KeyMembers = {}): boolean {
  return members(targetKey ?? {}).some(([name, member]) => typeof member === 'object' && ('change_id' in member || !(name in keyRoots)));
}

function members(targetKey: object): [string, KeyMember][] {
  return Object.entries(targetKey);
}
