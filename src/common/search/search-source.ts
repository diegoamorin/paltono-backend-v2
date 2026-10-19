import { EntityManager, EntityTarget, FindOptionsRelations, FindOptionsWhere, In, ObjectLiteral } from 'typeorm';
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

/**
 * A source of entries kept in one table and found by their titles, and by the
 * further `(id, text)` rows of `alsoTexts` when given.
 */
export function titleSearch<T extends ObjectLiteral & { id: string | number }>(source: {
  type: string;
  schema: AnyResourceSchema;
  /** The table, queried as `alias`. */
  table: string;
  alias: string;
  alsoTexts?: string;
  entity: EntityTarget<T>;
  relations: FindOptionsRelations<T>;
  /** Serializable entries of the loaded models, in their order. */
  entries(manager: EntityManager, models: T[], now: Date): Promise<unknown[]>;
}): SearchSource {
  const { type, schema, table, alias, alsoTexts, entity, relations, entries } = source;
  const titles = `SELECT ${alias}.id::text AS id, ${alias}.title AS text FROM ${table} ${alias} ${publishedRoot(alias)}`;
  return {
    type,
    schema,
    textsSql: alsoTexts ? `${titles} UNION ALL ${alsoTexts}` : titles,
    load: async (manager, ids, now) => {
      const models = await manager.find(entity, { where: { id: In(ids) } as FindOptionsWhere<T>, relations });
      return entries(manager, inOrder(ids, models, ({ id }) => id), now);
    },
  };
}

/** Returns the loaded models in the order of the given ids. */
export function inOrder<T>(ids: string[], models: T[], idOf: (model: T) => string | number): T[] {
  const byId = new Map(models.map((model) => [String(idOf(model)), model]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
