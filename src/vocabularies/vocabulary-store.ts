import { HttpStatus } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget, QueryFailedError, SelectQueryBuilder } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, CollectionQuerySpec } from '../common/json-api/query';
import { ResourceSchema } from '../common/json-api/resource-schema';
import { containsPattern } from '../database/like-pattern';

export interface VocabularyEntry {
  id: number;
}

/** Work outside the database, such as removing a stored file, that must wait for the write to commit. */
export type AfterCommit = () => Promise<void>;

/** Narrows a list query; `entry` is the alias of the vocabulary table. */
export type VocabularyFilter = (builder: SelectQueryBuilder<any>, value: string) => void;

/** How a shared vocabulary is stored and exposed. */
export interface Vocabulary<T extends VocabularyEntry> {
  /** Resource type, which is also its path under `/v1`. */
  type: string;
  entity: EntityTarget<T>;
  schema: ResourceSchema<T>;
  query: CollectionQuerySpec;
  filters: Record<string, VocabularyFilter>;
  /** The attribute behind each unique constraint, to report collisions. */
  uniqueAttributes: Record<string, string>;
  /** Relations loaded with every entry. */
  relations?: string[];
  /** Whether the table has `created_at` and `updated_at`. */
  timestamps?: boolean;
}

const UNIQUE_VIOLATION = '23505';
/** A restrictive foreign key reports `restrict_violation`; a NO ACTION one, `foreign_key_violation`. */
const IN_USE_VIOLATIONS = ['23001', '23503'];
const MAX_ID = 2 ** 31 - 1;

/**
 * Reads and administrator writes of one vocabulary. Deleting an entry that the
 * catalog references fails on the restrictive foreign keys and answers 409; the
 * database never cascades.
 */
export class VocabularyStore<T extends VocabularyEntry> {
  constructor(
    readonly vocabulary: Vocabulary<T>,
    protected readonly dataSource: DataSource,
    protected readonly clock: Clock,
  ) {}

  async list(query: CollectionQuery): Promise<{ entries: T[]; total: number }> {
    const builder = this.select(this.dataSource.manager);
    for (const [name, value] of Object.entries(query.filter)) this.vocabulary.filters[name](builder, value);
    query.sort.forEach(({ field, direction }, index) =>
      index === 0 ? builder.orderBy(`entry.${field}`, direction) : builder.addOrderBy(`entry.${field}`, direction),
    );
    const { skip, take } = pageWindow(query);
    const [entries, total] = await builder.skip(skip).take(take).getManyAndCount();
    return { entries, total };
  }

  async find(id: string): Promise<T> {
    return this.findIn(this.dataSource.manager, id);
  }

  async create(attributes: Partial<T>): Promise<T> {
    const now = this.clock.now();
    const stamps = this.vocabulary.timestamps ? { createdAt: now, updatedAt: now } : {};
    return this.write(async (manager) => {
      const entry = await manager.save(manager.create(this.vocabulary.entity, { ...attributes, ...stamps } as T));
      const afterCommit = await this.afterWrite(manager, entry, attributes);
      return { result: await this.findIn(manager, String(entry.id)), afterCommit };
    });
  }

  async update(id: string, attributes: Partial<T>): Promise<T> {
    const changes = Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Partial<T>;
    const stamps = this.vocabulary.timestamps ? { updatedAt: this.clock.now() } : {};
    return this.write(async (manager) => {
      const entry = await this.findIn(manager, id, { lock: true });
      await manager.save(this.vocabulary.entity, { ...entry, ...changes, ...stamps });
      // `entry` still holds the values from before the update.
      const afterCommit = await this.afterWrite(manager, entry, changes);
      return { result: await this.findIn(manager, id), afterCommit };
    });
  }

  async remove(id: string): Promise<void> {
    await this.write(async (manager) => {
      const entry = await this.findIn(manager, id, { lock: true });
      const afterCommit = await this.beforeRemove(manager, entry);
      await manager.delete(this.vocabulary.entity, { id: entry.id });
      return { result: undefined, afterCommit };
    });
  }

  /**
   * Writes what the entry owns besides its own row; runs in the write
   * transaction, with the entry as it was before an update. What it returns
   * runs once the transaction commits.
   */
  protected async afterWrite(_manager: EntityManager, _entry: T, _attributes: Partial<T>): Promise<AfterCommit | void> {}

  /**
   * Removes what the entry owns before the entry itself; runs in the delete
   * transaction. What it returns runs once the entry is deleted for good.
   */
  protected async beforeRemove(_manager: EntityManager, _entry: T): Promise<AfterCommit | void> {}

  private select(manager: EntityManager): SelectQueryBuilder<T> {
    const builder = manager.createQueryBuilder(this.vocabulary.entity, 'entry');
    for (const relation of this.vocabulary.relations ?? []) builder.leftJoinAndSelect(`entry.${relation}`, relation);
    return builder;
  }

  private async findIn(manager: EntityManager, id: string, { lock = false } = {}): Promise<T> {
    const entry =
      /^[1-9]\d{0,9}$/.test(id) && Number(id) <= MAX_ID
        ? lock
          ? await manager.findOne(this.vocabulary.entity, { where: { id: Number(id) } as never, lock: { mode: 'pessimistic_write' } })
          : await this.select(manager).where('entry.id = :id', { id: Number(id) }).getOne()
        : null;
    if (!entry) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'not_found', detail: `The ${this.vocabulary.type} entry does not exist` }]);
    return entry;
  }

  private async write<R>(work: (manager: EntityManager) => Promise<{ result: R; afterCommit: AfterCommit | void }>): Promise<R> {
    let done: { result: R; afterCommit: AfterCommit | void };
    try {
      done = await this.dataSource.transaction(work);
    } catch (error) {
      throw this.conflict(error) ?? error;
    }
    await done.afterCommit?.();
    return done.result;
  }

  private conflict(error: unknown): JsonApiException | undefined {
    if (!(error instanceof QueryFailedError)) return undefined;
    const { code, constraint } = error.driverError as { code?: string; constraint?: string };
    if (isInUseViolation(error)) {
      return new JsonApiException(HttpStatus.CONFLICT, [{ code: 'in_use', detail: 'The entry is in use by the catalog' }]);
    }
    const attribute = code === UNIQUE_VIOLATION && constraint ? this.vocabulary.uniqueAttributes[constraint] : undefined;
    if (!attribute) return undefined;
    return new JsonApiException(HttpStatus.CONFLICT, [
      { code: `${attribute}_taken`, detail: `${attribute} is already taken`, source: { pointer: `/data/attributes/${attribute}` } },
    ]);
  }
}

/** Whether a write failed because the catalog references the row it removes. */
export function isInUseViolation(error: unknown): boolean {
  const code = error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
  return code !== undefined && IN_USE_VIOLATIONS.includes(code);
}

/** Case- and accent-insensitive substring match on a column of the entry. */
export function containsFilter(column: string): VocabularyFilter {
  return (builder, value) => {
    const pattern = containsPattern(value);
    builder.andWhere(`unaccent(lower(entry.${column})) LIKE unaccent(lower(:contains_${column}))`, {
      [`contains_${column}`]: pattern,
    });
  };
}

/** Exact match on a column of the entry, after normalizing the value. */
export function equalsFilter(column: string, normalize: (value: string) => string = (value) => value): VocabularyFilter {
  return (builder, value) => {
    builder.andWhere(`entry.${column} = :equals_${column}`, { [`equals_${column}`]: normalize(value) });
  };
}
