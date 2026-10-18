import { EntityManager } from 'typeorm';
import { AnyResourceSchema } from '../json-api/resource-schema';

/**
 * What a module offers global search (S1) about one kind of entry, so that
 * discovery reads through the module instead of knowing its tables.
 */
export interface SearchSource {
  /** The JSON:API type of the entries, which `filter[type]` names. */
  type: string;
  schema: AnyResourceSchema;
  /**
   * SQL selecting `(id, text)`: each searchable name, alias or title of a
   * published entry, with the entry's internal id as text. Reservations have no
   * rows and withdrawn entries must be left out.
   */
  textsSql: string;
  /** The entries with the given internal ids, in that order, as `schema` serializes them. */
  load(manager: EntityManager, ids: string[], now: Date): Promise<unknown[]>;
}

/** The published roots of `alias`, joined on its `editorial_entity_id`. */
export const publishedRoot = (alias: string) =>
  `JOIN editorial_entities ${alias}_root ON ${alias}_root.id = ${alias}.editorial_entity_id AND ${alias}_root.publication_status = 'published'`;

/** Returns the loaded models in the order of the given ids. */
export function inOrder<T>(ids: string[], models: T[], idOf: (model: T) => string | number): T[] {
  const byId = new Map(models.map((model) => [String(idOf(model)), model]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
