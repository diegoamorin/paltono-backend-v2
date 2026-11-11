import { EntityManager } from 'typeorm';
import { identityPublicIdsOf, identityRootOfPublicId } from '../catalog-identities/identity-relations';
import { eventPublicIdsOf, eventRootOfPublicId, tourPublicIdsOf, tourRootOfPublicId } from '../live-events/live-events';
import { recordingPublicIdsOf, recordingRootOfPublicId } from '../music/recordings';
import { editionPublicIdsOf, editionRootOfPublicId, releasePublicIdsOf, releaseRootOfPublicId } from '../music/releases';
import { workPublicIdsOf, workRootOfPublicId } from '../music/works';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';

/*
 * The mark of a creation as a possible duplicate of a published entry. Authors
 * name the entry by the id of its public resource; the microchange keeps its
 * editorial root, outside the payload, and shows the public id again.
 */

/** How the module that owns each root type maps the id of its public resource to the editorial root, and back. */
const PUBLIC_IDS: Record<
  EditorialEntityType,
  {
    rootOf(manager: EntityManager, publicId: string): Promise<string | null>;
    publicIdsOf(manager: EntityManager, editorialEntityIds: string[]): Promise<Map<string, string>>;
  }
> = {
  identity: { rootOf: identityRootOfPublicId, publicIdsOf: identityPublicIdsOf },
  work: { rootOf: workRootOfPublicId, publicIdsOf: workPublicIdsOf },
  recording: { rootOf: recordingRootOfPublicId, publicIdsOf: recordingPublicIdsOf },
  release: { rootOf: releaseRootOfPublicId, publicIdsOf: releasePublicIdsOf },
  edition: { rootOf: editionRootOfPublicId, publicIdsOf: editionPublicIdsOf },
  event: { rootOf: eventRootOfPublicId, publicIdsOf: eventPublicIdsOf },
  tour: { rootOf: tourRootOfPublicId, publicIdsOf: tourPublicIdsOf },
};

export interface PossibleDuplicateProblem {
  code: string;
  detail: string;
}

/**
 * The editorial root of the published entry of the given type that a public
 * id names, or why it cannot be marked.
 */
export async function possibleDuplicateRoot(
  manager: EntityManager,
  entityType: EditorialEntityType,
  publicId: string,
): Promise<{ rootId: string } | { problem: PossibleDuplicateProblem }> {
  const rootId = await PUBLIC_IDS[entityType].rootOf(manager, publicId);
  const root = rootId && (await manager.findOne(EditorialEntity, { select: { id: true, publicationStatus: true }, where: { id: rootId } }));
  if (!root) {
    return { problem: { code: 'possible_duplicate_not_found', detail: `There is no ${entityType} with the public id ${publicId}` } };
  }
  if (root.publicationStatus !== 'published') {
    return { problem: { code: 'possible_duplicate_not_published', detail: 'A creation can only be marked as a duplicate of a published entry' } };
  }
  return { rootId: root.id };
}

/** The public id of each given root's entry, by root. */
export async function publicIdsOf(manager: EntityManager, roots: { id: string; entityType: EditorialEntityType }[]): Promise<Map<string, string>> {
  const publicIds = new Map<string, string>();
  for (const type of new Set(roots.map(({ entityType }) => entityType))) {
    const ids = roots.filter(({ entityType }) => entityType === type).map(({ id }) => id);
    for (const [rootId, publicId] of await PUBLIC_IDS[type].publicIdsOf(manager, ids)) publicIds.set(rootId, publicId);
  }
  return publicIds;
}
