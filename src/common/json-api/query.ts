import { HttpStatus } from '@nestjs/common';
import { JsonApiException } from './json-api.exception';
import { AnyResourceSchema, fieldNames } from './resource-schema';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
const MAX_INCLUDE_DEPTH = 2;

/** The id every sort ends with, so pages never overlap or skip resources. */
export const TIEBREAKER_SORT_FIELD = 'id';

export interface SortField {
  field: string;
  direction: 'ASC' | 'DESC';
}

/** What an endpoint returning a single resource accepts: `include` and `fields[type]`. */
export interface ResourceQuerySpec {
  kind: 'resource';
  schema: AnyResourceSchema;
  /** Allowed include paths, with every prefix of a declared path. */
  include: ReadonlySet<string>;
  /** Field names per type that may appear in the document. */
  fields: ReadonlyMap<string, ReadonlySet<string>>;
}

/** What a collection endpoint accepts: also `page`, `sort` and `filter`. */
export interface CollectionQuerySpec extends Omit<ResourceQuerySpec, 'kind'> {
  kind: 'collection';
  sort: ReadonlySet<string>;
  defaultSort: SortField[];
  filters: ReadonlySet<string>;
}

export type QuerySpec = ResourceQuerySpec | CollectionQuerySpec;

export interface ResourceQuery {
  /** Request path, used for links. */
  path: string;
  /** Requested include paths, with every prefix of a requested path. */
  include: string[];
  /** Requested fieldsets; a type without an entry gets all its fields. */
  fields: Map<string, Set<string>>;
}

export interface CollectionQuery extends ResourceQuery {
  page: { number: number; size: number };
  /** Requested or default sort, always ending with the id tiebreaker. */
  sort: SortField[];
  filter: Record<string, string>;
  /** The original query parameters, kept to build pagination links. */
  params: [string, string][];
}

export interface ResourceQueryOptions {
  /** Include paths of up to two levels, such as `maker.country`. */
  include?: string[];
}

export interface CollectionQueryOptions extends ResourceQueryOptions {
  /**
   * Other types the collection mixes with the schema's, as a heterogeneous
   * document does. An include path must exist on one of them at least.
   */
  alsoOf?: AnyResourceSchema[];
  /** Fields a client may sort by. `id` is always allowed and appended as tiebreaker. */
  sort: string[];
  /** Sort applied when the request has none, in `sort` syntax, such as `-createdAt`. */
  defaultSort: string;
  filters?: string[];
}

export function resourceQuery(schema: AnyResourceSchema, options: ResourceQueryOptions = {}): ResourceQuerySpec {
  const include = allowedIncludes([schema], options.include ?? []);
  return { kind: 'resource', schema, include, fields: fieldsByType([schema], include) };
}

export function collectionQuery(schema: AnyResourceSchema, options: CollectionQueryOptions): CollectionQuerySpec {
  const schemas = [schema, ...(options.alsoOf ?? [])];
  const include = allowedIncludes(schemas, options.include ?? []);
  const base = { schema, include, fields: fieldsByType(schemas, include) };
  const sort = new Set([...options.sort, TIEBREAKER_SORT_FIELD]);
  const defaultSort = parseSort(options.defaultSort, sort);
  if (!defaultSort) throw new Error(`Default sort "${options.defaultSort}" uses a field outside the allowed sort`);

  return { ...base, kind: 'collection', sort, defaultSort, filters: new Set(options.filters ?? []) };
}

type RawQuery = Record<string, unknown>;

export function parseQuery(spec: CollectionQuerySpec, raw: RawQuery, path: string): CollectionQuery;
export function parseQuery(spec: ResourceQuerySpec, raw: RawQuery, path: string): ResourceQuery;
export function parseQuery(spec: QuerySpec, raw: RawQuery, path: string): ResourceQuery | CollectionQuery;
export function parseQuery(spec: QuerySpec, raw: RawQuery, path: string): ResourceQuery | CollectionQuery {
  const query: ResourceQuery = { path, include: [], fields: new Map() };
  const collection = { page: { number: 1, size: DEFAULT_PAGE_SIZE }, sort: spec.kind === 'collection' ? spec.defaultSort : [] };
  const filter: Record<string, string> = {};
  const params: [string, string][] = [];

  for (const [parameter, rawValue] of Object.entries(raw)) {
    if (typeof rawValue !== 'string') throw badParameter(parameter, 'must appear once');
    const value = rawValue;
    params.push([parameter, value]);
    const family = /^(page|filter|fields)\[([^\]]*)\]$/.exec(parameter);

    if (parameter === 'include') {
      query.include = parseInclude(value, spec.include);
    } else if (family?.[1] === 'fields') {
      query.fields.set(family[2], parseFieldset(parameter, family[2], value, spec.fields));
    } else if (spec.kind === 'collection' && parameter === 'sort') {
      const sort = parseSort(value, spec.sort);
      if (!sort) throw badParameter('sort', `must list fields among: ${[...spec.sort].join(', ')}`);
      collection.sort = sort;
    } else if (spec.kind === 'collection' && family?.[1] === 'page') {
      parsePage(parameter, family[2], value, collection.page);
    } else if (spec.kind === 'collection' && family?.[1] === 'filter' && spec.filters.has(family[2])) {
      filter[family[2]] = value;
    } else {
      throw badParameter(parameter, 'is not supported by this endpoint');
    }
  }

  if (spec.kind === 'resource') return query;
  return { ...query, ...collection, sort: withTiebreaker(collection.sort), filter, params };
}

function parseInclude(value: string, allowed: ReadonlySet<string>): string[] {
  if (value === '') return [];
  const requested = new Set<string>();
  for (const path of value.split(',')) {
    if (!allowed.has(path)) throw badParameter('include', `"${path}" is not an allowed include path`);
    for (const prefix of prefixes(path)) requested.add(prefix);
  }
  return [...requested];
}

function parseFieldset(
  parameter: string,
  type: string,
  value: string,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const fields = allowed.get(type);
  if (!fields) throw badParameter(parameter, `"${type}" is not a type this endpoint returns`);

  const requested = new Set(value === '' ? [] : value.split(','));
  for (const field of requested) {
    if (!fields.has(field)) throw badParameter(parameter, `"${field}" is not a field of ${type}`);
  }
  return requested;
}

function parseSort(value: string, allowed: ReadonlySet<string>): SortField[] | undefined {
  const sort: SortField[] = [];
  for (const item of value.split(',')) {
    const descending = item.startsWith('-');
    const field = descending ? item.slice(1) : item;
    if (!allowed.has(field)) return undefined;
    sort.push({ field, direction: descending ? 'DESC' : 'ASC' });
  }
  return sort;
}

function withTiebreaker(sort: SortField[]): SortField[] {
  if (sort.some(({ field }) => field === TIEBREAKER_SORT_FIELD)) return sort;
  return [...sort, { field: TIEBREAKER_SORT_FIELD, direction: 'ASC' }];
}

function parsePage(parameter: string, member: string, value: string, page: { number: number; size: number }): void {
  if (member !== 'number' && member !== 'size') throw badParameter(parameter, 'is not supported; use page[number] and page[size]');
  const number = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (member === 'number') {
    if (!Number.isSafeInteger(number)) throw badParameter(parameter, 'must be a positive integer');
    page.number = number;
  } else {
    if (!(number <= MAX_PAGE_SIZE)) throw badParameter(parameter, `must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    page.size = number;
  }
}

function allowedIncludes(schemas: AnyResourceSchema[], paths: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const path of paths) {
    const segments = path.split('.');
    if (segments.length > MAX_INCLUDE_DEPTH) throw new Error(`Include path "${path}" is deeper than ${MAX_INCLUDE_DEPTH} levels`);
    if (resolvedPaths(schemas, segments).length === 0) resolvePath(schemas[0], segments);
    for (const prefix of prefixes(path)) allowed.add(prefix);
  }
  return allowed;
}

function fieldsByType(schemas: AnyResourceSchema[], include: ReadonlySet<string>): Map<string, Set<string>> {
  const all = [...schemas, ...[...include].flatMap((path) => resolvedPaths(schemas, path.split('.')))];
  return new Map(all.map((each) => [each.type, new Set(fieldNames(each))]));
}

/** The schemas at the end of a relationship path from each of the given ones that has it. */
function resolvedPaths(schemas: AnyResourceSchema[], segments: string[]): AnyResourceSchema[] {
  return schemas.flatMap((schema) => {
    try {
      return [resolvePath(schema, segments)];
    } catch {
      return [];
    }
  });
}

/** The schema at the end of a relationship path; throws if the path does not exist. */
export function resolvePath(schema: AnyResourceSchema, segments: string[]): AnyResourceSchema {
  return segments.reduce((current, segment) => {
    const relationship = current.relationships?.[segment];
    if (!relationship) throw new Error(`${current.type} has no relationship "${segment}"`);
    return relationship.schema();
  }, schema);
}

function prefixes(path: string): string[] {
  const segments = path.split('.');
  return segments.map((_, index) => segments.slice(0, index + 1).join('.'));
}

/** Rejects a filter value outside the allowed ones with 400. */
export function requireOneOf(parameter: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new JsonApiException(HttpStatus.BAD_REQUEST, [
      { detail: `${parameter} must be one of: ${allowed.join(', ')}`, source: { parameter } },
    ]);
  }
}

/** The period a date filter value names, YYYY, YYYY-MM or YYYY-MM-DD, as the ISO dates it spans; otherwise 400. */
export function period(parameter: string, value: string): { first: string; last: string } {
  const named = namedPeriod(value);
  if (!named) throw badParameter(parameter, 'must be a date as YYYY, YYYY-MM or YYYY-MM-DD');
  return named;
}

function namedPeriod(value: string): { first: string; last: string } | undefined {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const y = Number(year);
  const m = month === undefined ? undefined : Number(month);
  const d = day === undefined ? undefined : Number(day);
  if (y < 1 || (m !== undefined && (m < 1 || m > 12))) return undefined;
  const lastDay = (mm: number) => new Date(Date.UTC(y, mm, 0)).getUTCDate();
  if (m !== undefined && d !== undefined && (d < 1 || d > lastDay(m))) return undefined;
  const iso = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (m === undefined) return { first: iso(1, 1), last: iso(12, 31) };
  if (d === undefined) return { first: iso(m, 1), last: iso(m, lastDay(m)) };
  return { first: iso(m, d), last: iso(m, d) };
}

function badParameter(parameter: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.BAD_REQUEST, [{ detail: `${parameter} ${detail}`, source: { parameter } }]);
}
