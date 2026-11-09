import { EntityManager } from 'typeorm';
import { EditorialEntityType, PublicationStatus } from './entities/editorial-entity.entity';

/*
 * The mark of a creation as a possible duplicate of a published entry. Authors
 * name the entry by the id of its public resource; the microchange keeps its
 * editorial root, outside the payload, and shows the public id again.
 */

/** Where each root type keeps the id of its public resource: a work's is its own id, the others' their `public_id`. */
const PUBLIC_IDS: Record<EditorialEntityType, { table: string; column: string }> = {
  identity: { table: 'catalog_identities', column: 'public_id' },
  work: { table: 'works', column: 'id::text' },
  recording: { table: 'recordings', column: 'public_id' },
  release_group: { table: 'release_groups', column: 'public_id' },
  release: { table: 'releases', column: 'public_id' },
  event: { table: 'events', column: 'public_id' },
  tour: { table: 'tours', column: 'public_id' },
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
  const { table, column } = PUBLIC_IDS[entityType];
  const [entry]: { root_id: string; publication_status: PublicationStatus }[] = await manager.query(
    `SELECT root.id AS root_id, root.publication_status FROM ${table} entry
     JOIN editorial_entities root ON root.id = entry.editorial_entity_id
     WHERE entry.${column} = $1`,
    [publicId],
  );
  if (!entry) {
    return { problem: { code: 'possible_duplicate_not_found', detail: `There is no ${entityType} with the public id ${publicId}` } };
  }
  if (entry.publication_status !== 'published') {
    return { problem: { code: 'possible_duplicate_not_published', detail: 'A creation can only be marked as a duplicate of a published entry' } };
  }
  return { rootId: entry.root_id };
}

/** The public id of each given root's entry, by root. */
export async function publicIdsOf(manager: EntityManager, roots: { id: string; entityType: EditorialEntityType }[]): Promise<Map<string, string>> {
  const publicIds = new Map<string, string>();
  for (const type of new Set(roots.map(({ entityType }) => entityType))) {
    const { table, column } = PUBLIC_IDS[type];
    const ids = roots.filter(({ entityType }) => entityType === type).map(({ id }) => id);
    const rows: { root_id: string; public_id: string }[] = await manager.query(
      `SELECT editorial_entity_id AS root_id, ${column} AS public_id FROM ${table} WHERE editorial_entity_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const { root_id, public_id } of rows) publicIds.set(root_id, public_id);
  }
  return publicIds;
}
