import { JSON_API_VERSION } from './media-type';
import { CollectionQuery, ResourceQuery } from './query';
import { AnyResourceSchema, ResourceSchema } from './resource-schema';

export interface ResourceIdentifier {
  type: string;
  id: string;
}

export interface ResourceObject extends ResourceIdentifier {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: ResourceIdentifier | ResourceIdentifier[] | null }>;
  meta?: Record<string, unknown>;
}

export interface JsonApiDocument<Data extends ResourceObject | ResourceObject[] | null> {
  jsonapi: typeof JSON_API_VERSION;
  data: Data;
  included?: ResourceObject[];
  links: Record<string, string | null>;
  meta?: Record<string, unknown>;
}

/** Builds the document for one resource, with the related resources the query includes. */
export function resourceDocument<T>(
  schema: ResourceSchema<T>,
  model: T,
  query: ResourceQuery,
): JsonApiDocument<ResourceObject> {
  const data = toResourceObject(schema, model, query.fields);
  return withIncluded({ jsonapi: JSON_API_VERSION, data, links: { self: query.path } }, schema, [model], query);
}

/** Builds the document for a few resources that one request produced together, without pagination. */
export function resourcesDocument<T>(
  schema: ResourceSchema<T>,
  models: T[],
  query: ResourceQuery,
): JsonApiDocument<ResourceObject[]> {
  const data = models.map((model) => toResourceObject(schema, model, query.fields));
  return withIncluded({ jsonapi: JSON_API_VERSION, data, links: { self: query.path } }, schema, models, query);
}

/** Builds the document for one page of a collection, with pagination links and `meta.total`. */
export function collectionDocument<T>(
  schema: ResourceSchema<T>,
  models: T[],
  total: number,
  query: CollectionQuery,
): JsonApiDocument<ResourceObject[]> {
  const data = models.map((model) => toResourceObject(schema, model, query.fields));
  const document = { jsonapi: JSON_API_VERSION, data, links: paginationLinks(total, query), meta: { total } };
  return withIncluded(document, schema, models, query);
}

/** Converts a page request into the rows to skip and take. */
export function pageWindow(query: CollectionQuery): { skip: number; take: number } {
  return { skip: (query.page.number - 1) * query.page.size, take: query.page.size };
}

function toResourceObject<T>(schema: ResourceSchema<T>, model: T, fields: Map<string, Set<string>>): ResourceObject {
  const fieldset = fields.get(schema.type);
  const visible = (name: string) => !fieldset || fieldset.has(name);
  const object: ResourceObject = { type: schema.type, id: schema.id(model) };

  const attributes = Object.entries(schema.attributes)
    .filter(([name]) => visible(name))
    .map(([name, read]) => [name, read(model)] as const);
  if (attributes.length > 0) object.attributes = Object.fromEntries(attributes);

  const relationships = Object.entries(schema.relationships ?? {})
    .filter(([name]) => visible(name))
    .map(([name, relationship]) => [name, relationship.schema(), relationship.get(model)] as const)
    .filter(([, , related]) => related !== undefined)
    .map(([name, relatedSchema, related]) => [name, { data: linkage(relatedSchema, related) }] as const);
  if (relationships.length > 0) object.relationships = Object.fromEntries(relationships);
  if (schema.meta) object.meta = schema.meta(model);

  return object;
}

function linkage(schema: AnyResourceSchema, related: unknown): ResourceIdentifier | ResourceIdentifier[] | null {
  if (related === null) return null;
  if (Array.isArray(related)) return related.map((model) => ({ type: schema.type, id: schema.id(model) }));
  return { type: schema.type, id: schema.id(related) };
}

function withIncluded<D extends JsonApiDocument<ResourceObject | ResourceObject[]>, T>(
  document: D,
  schema: ResourceSchema<T>,
  models: T[],
  query: ResourceQuery,
): D {
  if (query.include.length === 0) return document;

  const primary = new Set(models.map((model) => key(schema.type, schema.id(model))));
  const included = new Map<string, ResourceObject>();
  for (const path of query.include) {
    for (const [relatedSchema, related] of walk(schema, models, path.split('.'))) {
      const id = key(relatedSchema.type, relatedSchema.id(related));
      if (!primary.has(id) && !included.has(id)) {
        included.set(id, toResourceObject(relatedSchema, related, query.fields));
      }
    }
  }
  return { ...document, included: [...included.values()] };
}

/** Follows a relationship path from the given models and returns the models at its end. */
function walk(schema: AnyResourceSchema, models: unknown[], segments: string[]): [AnyResourceSchema, unknown][] {
  let current: [AnyResourceSchema, unknown[]] = [schema, models];
  for (const segment of segments) {
    const relationship = current[0].relationships![segment];
    const related = current[1].flatMap((model) => relationship.get(model) ?? []);
    current = [relationship.schema(), related];
  }
  const [endSchema, endModels] = current;
  return endModels.map((model) => [endSchema, model]);
}

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

function paginationLinks(total: number, query: CollectionQuery): Record<string, string | null> {
  const { number, size } = query.page;
  const last = Math.max(1, Math.ceil(total / size));
  const link = (page: number) => {
    const params = new URLSearchParams(query.params.filter(([name]) => !name.startsWith('page[')));
    params.set('page[number]', String(page));
    params.set('page[size]', String(size));
    return `${query.path}?${params}`;
  };

  return {
    self: link(number),
    first: link(1),
    prev: number > 1 ? link(Math.min(number - 1, last)) : null,
    next: number < last ? link(number + 1) : null,
    last: link(last),
  };
}
