import { EntityManager } from 'typeorm';
import { PartialDate, partialDateIntervalSql, partialDateResponse } from '../common/partial-date/partial-date';

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

/** SQL expressions over an `editions` row aliased `r` that do not depend on the current time. */
export function releaseDateSql(r: string) {
  const { start, end } = partialDateIntervalSql(r, 'release');
  const instant = `CASE WHEN ${r}.release_time IS NOT NULL THEN (make_date(${r}.release_year, ${r}.release_month, ${r}.release_day) + ${r}.release_time) AT TIME ZONE ${r}.timezone END`;
  return { start, end, instant };
}

/** SQL expressions over an `editions` row aliased `r`; `now` is an SQL expression of a timestamptz. */
export function releaseSql(r: string, now: string) {
  const year = `${r}.release_year`;
  const { start, end, instant } = releaseDateSql(r);
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
  return `FROM editions ${r} JOIN editorial_entities ${r}_root ON ${r}_root.id = ${r}.editorial_entity_id
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

/**
 * The releases a recording's release date comes from: those with a track of
 * it, under the same rule as a release group's.
 */
function releasesOfRecordingSql(r: string, recording: string): string {
  return `FROM editions ${r} JOIN editorial_entities ${r}_root ON ${r}_root.id = ${r}.editorial_entity_id
      JOIN tracks ${r}_track ON ${r}_track.edition_id = ${r}.id
    WHERE ${r}_track.recording_id = ${recording} AND NOT ${r}.is_cancelled AND ${r}.release_year IS NOT NULL
      AND ${r}_root.publication_status = 'published'`;
}

/**
 * SQL expressions over a `recordings` row aliased `rec`, for filters and
 * sorts: the first day of its release date and the year of it, null without one.
 */
export function recordingReleaseSql(rec: string) {
  const r = `${rec}_release`;
  const { start, instant } = releaseDateSql(r);
  const first = (column: string) => `(SELECT ${column} ${releasesOfRecordingSql(r, `${rec}.id`)} ORDER BY ${start}, ${instant} NULLS LAST, ${r}.id LIMIT 1)`;
  return { start: first(start), year: first(`${r}.release_year`) };
}

/**
 * The recordings that may be the first recording of a work: the published
 * ones that perform it, aliased `rec`, linked through `${rec}_link`. Samples
 * and interpolations do not count.
 */
export function performancesSql(rec: string, work: string): string {
  return `FROM recording_works ${rec}_link
      JOIN recordings ${rec} ON ${rec}.id = ${rec}_link.recording_id
      JOIN editorial_entities ${rec}_root ON ${rec}_root.id = ${rec}.editorial_entity_id
    WHERE ${rec}_link.work_id = ${work} AND ${rec}_link.relation_type = 'performance' AND ${rec}_root.publication_status = 'published'`;
}

/**
 * SQL expression over a `works` row aliased `w`, for sorts: the first day of
 * the release date of its first recording, null without one.
 */
export function workReleaseStartSql(w: string): string {
  const rec = `${w}_recording`;
  return `(SELECT min(${recordingReleaseSql(rec).start}) ${performancesSql(rec, `${w}.id`)})`;
}

/**
 * The release date of each recording, by id: the earliest date of the
 * releases it is on, as a release group's date is the earliest of its
 * releases. Future releases count; null without any.
 */
export async function recordingReleaseDates(manager: EntityManager, ids: number[]): Promise<Map<number, PartialDate | null>> {
  const dates = new Map<number, PartialDate | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return dates;
  const { start, instant } = releaseDateSql('r');
  const rows: { recordingId: number; releaseYear: number; releaseMonth: number | null; releaseDay: number | null }[] = await manager.query(
    `SELECT DISTINCT ON (r_track.recording_id) r_track.recording_id AS "recordingId",
        r.release_year AS "releaseYear", r.release_month AS "releaseMonth", r.release_day AS "releaseDay"
      ${releasesOfRecordingSql('r', 'ANY($1)')}
      ORDER BY r_track.recording_id, ${start}, ${instant} NULLS LAST, r.id`,
    [ids],
  );
  for (const row of rows) dates.set(row.recordingId, partialDateResponse(row, 'release'));
  return dates;
}

/** The availability and instant of each release, by id. */
export async function releaseTimes(manager: EntityManager, ids: number[], now: Date): Promise<Map<number, ReleaseTimes>> {
  if (ids.length === 0) return new Map();
  const { instant, availability } = releaseSql('r', '$2::timestamptz');
  const rows: { id: number; instant: Date | null; availability: ReleaseAvailability }[] = await manager.query(
    `SELECT r.id, ${instant} AS instant, ${availability} AS availability FROM editions r WHERE r.id = ANY($1)`,
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
  const rows: { groupId: number; releaseYear: number; releaseMonth: number | null; releaseDay: number | null; instant: Date | null; arrived: boolean }[] =
    await manager.query(
      `SELECT r.release_group_id AS "groupId", r.release_year AS "releaseYear", r.release_month AS "releaseMonth", r.release_day AS "releaseDay",
          ${instant} AS instant, ${arrived} AS arrived
        FROM editions r JOIN editorial_entities root ON root.id = r.editorial_entity_id
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
      releaseDate: partialDateResponse(own[0], 'release'),
      upcoming: toCome.length === own.length,
      nextReleaseDate: toCome.length > 0 ? partialDateResponse(toCome[0], 'release') : null,
      releaseInstant: instants[0] ?? null,
    });
  }
  return dates;
}
