import { EntityManager, Not, QueryFailedError } from 'typeorm';
import { Work } from './entities/work.entity';

/*
 * The writes of a work, which this module owns. The editorial flow calls them
 * inside the transaction that applies a microchange, so the domain rows, the
 * decision and the revision commit together.
 */

/** A work as its creation proposes it and its revisions record it. The slug is generated, never proposed. */
export interface WorkValue {
  title: string;
  description?: string | null;
  iswc?: string | null;
}

export const WORK_FIELDS = {
  'works.title': 'title',
  'works.description': 'description',
  'works.iswc': 'iswc',
} as const;
export type WorkFieldPath = keyof typeof WORK_FIELDS;

const UNIQUE_VIOLATION = '23505';
const SLUG_MAX_LENGTH = 300;

/** The internal id of the work of an editorial root, or null while it is only reserved. */
export async function workIdOf(manager: EntityManager, editorialEntityId: string): Promise<string | null> {
  const work = await manager.findOne(Work, { select: { id: true }, where: { editorialEntityId } });
  return work?.id ?? null;
}

/** The work of an editorial root with the value its rows hold, or null while it is only reserved. */
export async function findCreatedWork(manager: EntityManager, editorialEntityId: string): Promise<{ work: Work; value: WorkValue } | null> {
  const work = await manager.findOneBy(Work, { editorialEntityId });
  return work && { work, value: { title: work.title, description: work.description, iswc: work.iswc } };
}

/**
 * Inserts the work of an editorial root with a slug from its title. Another
 * work may hold that slug, or take it concurrently: the database's uniqueness
 * decides, and the next free suffix is tried (`butter-2`, `butter-3`…).
 */
export async function createWork(manager: EntityManager, editorialEntityId: string, value: WorkValue, now: Date): Promise<Work> {
  const base = slugOf(value.title);
  for (;;) {
    const slug = await nextFreeSlug(manager, base);
    try {
      // A savepoint, so a slug taken meanwhile leaves the transaction usable for the next try.
      await manager.transaction((savepoint) =>
        savepoint.insert(Work, {
          title: value.title,
          slug,
          description: value.description ?? null,
          iswc: value.iswc ?? null,
          createdAt: now,
          updatedAt: now,
          editorialEntityId,
        }),
      );
      return manager.findOneByOrFail(Work, { editorialEntityId });
    } catch (error) {
      if (!isViolationOf(error, 'works_slug_key')) throw error;
    }
  }
}

export async function writeWorkField(manager: EntityManager, editorialEntityId: string, path: WorkFieldPath, value: unknown, now: Date): Promise<unknown> {
  await manager.update(Work, { editorialEntityId }, { [WORK_FIELDS[path]]: value, updatedAt: now });
  const { value: written } = (await findCreatedWork(manager, editorialEntityId))!;
  return written[WORK_FIELDS[path]];
}

/** What an ISWC would break: its uniqueness among works other than the given one. */
export async function iswcClashes(manager: EntityManager, iswc: string | null | undefined, editorialEntityId: string): Promise<string[]> {
  if (!iswc) return [];
  const other = await manager.existsBy(Work, { iswc, editorialEntityId: Not(editorialEntityId) });
  return other ? [`Otra obra ya tiene el ISWC ${iswc}`] : [];
}

/** Whether an ISWC's last digit is its check digit: 1 plus each of the nine digits by its position, to the next ten. */
export function hasValidIswcCheckDigit(iswc: string): boolean {
  const digits = [...iswc.slice(1)].map(Number);
  const sum = digits.slice(0, 9).reduce((total, digit, index) => total + digit * (index + 1), 1);
  return (10 - (sum % 10)) % 10 === digits[9];
}

/**
 * The slug of a title: lower-case letters and digits of any script, accents
 * removed, every other run of characters a hyphen. A title with neither
 * letters nor digits gets `work`.
 */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'work' : slug;
}

/** The base, or the first `base-N` from 2 on that no work holds. */
async function nextFreeSlug(manager: EntityManager, base: string): Promise<string> {
  const rows: { slug: string }[] = await manager.query(`SELECT slug FROM works WHERE slug = $1 OR slug LIKE $2`, [base, `${escapeLike(base)}-%`]);
  const taken = new Set(rows.map(({ slug }) => slug));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function isViolationOf(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return driverError.code === UNIQUE_VIOLATION && driverError.constraint === constraint;
}
