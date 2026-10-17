import { EntityManager } from 'typeorm';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { ProposalChange } from './entities/proposal-change.entity';
import { ChangeDependency } from './entities/proposal-links.entity';

/*
 * The dependency graph of one proposal. It must be acyclic both as declared
 * and once each atomic group collapses into a single node, because a group
 * applies as one step: a group that depends on a microchange depending on the
 * group could never apply.
 */

type Edge = Pick<ChangeDependency, 'changeId' | 'dependsOnChangeId'>;

/** Whether the dependencies of a proposal, as stored now, form a cycle. */
export async function hasDependencyCycle(manager: EntityManager, proposalId: string): Promise<boolean> {
  const changes = await manager.find(ProposalChange, { where: { proposalId }, select: { id: true, atomicGroupId: true } });
  const edges = await manager.findBy(ChangeDependency, { proposalId });
  const groupOf = new Map(changes.map(({ id, atomicGroupId }) => [id, atomicGroupId ? `group:${atomicGroupId}` : id]));
  const collapsed = edges
    .map(({ changeId, dependsOnChangeId }) => ({ changeId: groupOf.get(changeId)!, dependsOnChangeId: groupOf.get(dependsOnChangeId)! }))
    .filter(({ changeId, dependsOnChangeId }) => changeId !== dependsOnChangeId);
  return hasCycle(edges) || hasCycle(collapsed);
}

/** The error for a dependency graph with a cycle, as declared or once its atomic groups collapse. */
export function dependencyCycle(pointer = '/data'): JsonApiErrorInput {
  return {
    code: 'dependency_cycle',
    detail: 'The dependencies would form a cycle, as declared or once each atomic group applies as one step',
    source: { pointer },
  };
}

/**
 * Orders microchanges so each comes after those of the list it depends on,
 * keeping the given order otherwise. The graph is acyclic.
 */
export function inDependencyOrder<T extends { id: string }>(changes: T[], edges: Edge[]): T[] {
  const ordered: T[] = [];
  const placed = new Set<string>();
  const ids = new Set(changes.map(({ id }) => id));
  while (ordered.length < changes.length) {
    const next = changes.find(
      ({ id }) =>
        !placed.has(id) &&
        edges.every(({ changeId, dependsOnChangeId }) => changeId !== id || !ids.has(dependsOnChangeId) || placed.has(dependsOnChangeId)),
    )!;
    ordered.push(next);
    placed.add(next.id);
  }
  return ordered;
}

function hasCycle(edges: Edge[]): boolean {
  const next = new Map<string, string[]>();
  for (const { changeId, dependsOnChangeId } of edges) next.set(changeId, [...(next.get(changeId) ?? []), dependsOnChangeId]);
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (node: string): boolean => {
    if (onPath.has(node)) return true;
    if (done.has(node)) return false;
    onPath.add(node);
    const cyclic = (next.get(node) ?? []).some(visit);
    onPath.delete(node);
    done.add(node);
    return cyclic;
  };
  return [...next.keys()].some(visit);
}
