import { EntityManager } from 'typeorm';

/*
 * When releases come out, derived on every read from what they store and the
 * current time; nothing here is stored. A release's date is partial: it
 * stands for the period from its first possible day (`start`) to its last
 * (`end`). With a time and an IANA zone, which only a complete date has, it
 * also has the instant a countdown uses.
 *
 * A release has come out once its instant has passed or, without one, once
 * the first day of its known date has come (in UTC): a release announced for
 * "November 2026" is upcoming until November starts. Availability:
 * `cancelled` when cancelled, `unknown` without a date, else `upcoming` or
 * `released`.
 *
 * A release group's dates come from its published, non-cancelled releases with
 * a date: its date is the earliest of them, it is upcoming while none of them
 * has come out, its next release is the earliest one still to come and its
 * countdown goes to the first instant still to come.
 */

export const RELEASE_AVAILABILITIES = ['upcoming', 'released', 'cancelled', 'unknown'] as const;
export type ReleaseAvailability = (typeof RELEASE_AVAILABILITIES)[number];

export interface PartialDate {
  year: number;
  month: number | null;
  day: number | null;
}

export interface ReleaseTimes {
  availability: ReleaseAvailability;
  /** The instant of its time in its zone, or null without one. */
  instant: Date | null;
}

export interface ReleaseGroupDates {
  releaseDate: PartialDate | null;
  upcoming: boolean;
  nextReleaseDate: PartialDate | null;
  /** The countdown's target: the first instant of a release still to come. */
  releaseInstant: Date | null;
}

/** SQL expressions over a `releases` row aliased `r`; `now` is an SQL expression of a timestamptz. */
export function releaseSql(r: string, now: string) {
  const year = `${r}.release_year`;
  const month = `${r}.release_month`;
  const day = `${r}.release_day`;
  const start = `CASE WHEN ${year} IS NOT NULL THEN make_date(${year}, coalesce(${month}, 1), coalesce(${day}, 1)) END`;
  const end = `CASE
      WHEN ${day} IS NOT NULL THEN make_date(${year}, ${month}, ${day})
      WHEN ${month} IS NOT NULL THEN (make_date(${year}, ${month}, 1) + interval '1 month - 1 day')::date
      WHEN ${year} IS NOT NULL THEN make_date(${year}, 12, 31)
    END`;
  const instant = `CASE WHEN ${r}.release_time IS NOT NULL THEN (make_date(${year}, ${month}, ${day}) + ${r}.release_time) AT TIME ZONE ${r}.timezone END`;
  const arrived = `CASE WHEN ${r}.release_time IS NOT NULL THEN ${instant} <= ${now} ELSE ${start} <= (${now} AT TIME ZONE 'UTC')::date END`;
  const availability = `CASE
      WHEN ${r}.is_cancelled THEN 'cancelled'
      WHEN ${year} IS NULL THEN 'unknown'
      WHEN ${arrived} THEN 'released'
      ELSE 'upcoming'
    END`;
  return { start, end, instant, arrived, availability };
}

/** The releases a release group's dates come from: published, not cancelled and with a date. */
export function datedReleasesSql(r: string, group: string): string {
  return `FROM releases ${r} JOIN editorial_entities ${r}_root ON ${r}_root.id = ${r}.editorial_entity_id
    WHERE ${r}.release_group_id = ${group} AND NOT ${r}.is_cancelled AND ${r}.release_year IS NOT NULL
      AND ${r}_root.publication_status = 'published'`;
}

/** SQL expressions over a `release_groups` row aliased `g`, for filters and sorts. */
export function releaseGroupSql(g: string, now: string) {
  const r = `${g}_release`;
  const { start, end, instant, arrived } = releaseSql(r, now);
  const first = (column: string) => `(SELECT ${column} ${datedReleasesSql(r, `${g}.id`)} ORDER BY ${start}, ${instant} NULLS LAST, ${r}.id LIMIT 1)`;
  return {
    start: first(start),
    end: first(end),
    upcoming: `(EXISTS (SELECT 1 ${datedReleasesSql(r, `${g}.id`)}) AND NOT EXISTS (SELECT 1 ${datedReleasesSql(r, `${g}.id`)} AND ${arrived}))`,
  };
}

/** The availability and instant of each release, by id. */
export async function releaseTimes(manager: EntityManager, ids: number[], now: Date): Promise<Map<number, ReleaseTimes>> {
  if (ids.length === 0) return new Map();
  const { instant, availability } = releaseSql('r', '$2::timestamptz');
  const rows: { id: number; instant: Date | null; availability: ReleaseAvailability }[] = await manager.query(
    `SELECT r.id, ${instant} AS instant, ${availability} AS availability FROM releases r WHERE r.id = ANY($1)`,
    [ids, now],
  );
  return new Map(rows.map(({ id, instant: at, availability: state }) => [id, { instant: at && new Date(at), availability: state }]));
}

/** The dates of each release group, by id. */
export async function releaseGroupDates(manager: EntityManager, ids: number[], now: Date): Promise<Map<number, ReleaseGroupDates>> {
  const dates = new Map<number, ReleaseGroupDates>(
    ids.map((id) => [id, { releaseDate: null, upcoming: false, nextReleaseDate: null, releaseInstant: null }]),
  );
  if (ids.length === 0) return dates;
  const { start, instant, arrived } = releaseSql('r', '$2::timestamptz');
  const rows: { groupId: number; year: number; month: number | null; day: number | null; instant: Date | null; arrived: boolean }[] =
    await manager.query(
      `SELECT r.release_group_id AS "groupId", r.release_year AS year, r.release_month AS month, r.release_day AS day,
          ${instant} AS instant, ${arrived} AS arrived
        FROM releases r JOIN editorial_entities root ON root.id = r.editorial_entity_id
        WHERE r.release_group_id = ANY($1) AND NOT r.is_cancelled AND r.release_year IS NOT NULL AND root.publication_status = 'published'
        ORDER BY ${start}, ${instant} NULLS LAST, r.id`,
      [ids, now],
    );
  for (const id of ids) {
    const own = rows.filter(({ groupId }) => groupId === id);
    if (own.length === 0) continue;
    const toCome = own.filter(({ arrived: out }) => !out);
    const instants = toCome.flatMap(({ instant: at }) => (at ? [new Date(at)] : [])).sort((a, b) => a.getTime() - b.getTime());
    dates.set(id, {
      releaseDate: partialDate(own[0]),
      upcoming: toCome.length === own.length,
      nextReleaseDate: toCome.length > 0 ? partialDate(toCome[0]) : null,
      releaseInstant: instants[0] ?? null,
    });
  }
  return dates;
}

const partialDate = ({ year, month, day }: { year: number; month: number | null; day: number | null }): PartialDate => ({ year, month, day });
