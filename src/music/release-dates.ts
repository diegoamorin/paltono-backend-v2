import { EntityManager } from 'typeorm';
import { PartialDate, partialDateIntervalSql, partialDateResponse } from '../common/partial-date/partial-date';

/*
 * When editions come out, derived on every read from what they store and the
 * current time; nothing here is stored. An edition's release date is partial:
 * it stands for the period from its first possible day (`start`) to its last
 * (`end`). With a time and an IANA zone, which only a complete date has, it
 * also has the instant a countdown uses.
 *
 * An edition has come out once its instant has passed or, without one, once
 * the first day of its known date has come (in UTC): an edition announced for
 * "November 2026" is upcoming until November starts. Availability:
 * `cancelled` when cancelled, `unknown` without a date, else `upcoming` or
 * `released`.
 *
 * A release's dates come from its published, non-cancelled editions with a
 * date: its date is the earliest of them, it is upcoming while none of them
 * has come out, its next release date is the earliest one still to come and
 * its countdown goes to the first instant still to come.
 */

export const EDITION_AVAILABILITIES = ['upcoming', 'released', 'cancelled', 'unknown'] as const;
export type EditionAvailability = (typeof EDITION_AVAILABILITIES)[number];

export interface EditionTimes {
  availability: EditionAvailability;
  /** The instant of its time in its zone, or null without one. */
  instant: Date | null;
}

export interface ReleaseDates {
  releaseDate: PartialDate | null;
  upcoming: boolean;
  nextReleaseDate: PartialDate | null;
  /** The countdown's target: the first instant of an edition still to come. */
  releaseInstant: Date | null;
}

/** SQL expressions over an `editions` row aliased `e` that do not depend on the current time. */
export function editionDateSql(e: string) {
  const { start, end } = partialDateIntervalSql(e, 'release');
  const instant = `CASE WHEN ${e}.release_time IS NOT NULL THEN (make_date(${e}.release_year, ${e}.release_month, ${e}.release_day) + ${e}.release_time) AT TIME ZONE ${e}.timezone END`;
  return { start, end, instant };
}

/** SQL expressions over an `editions` row aliased `e`; `now` is an SQL expression of a timestamptz. */
export function editionSql(e: string, now: string) {
  const year = `${e}.release_year`;
  const { start, end, instant } = editionDateSql(e);
  const arrived = `CASE WHEN ${e}.release_time IS NOT NULL THEN ${instant} <= ${now} ELSE ${start} <= (${now} AT TIME ZONE 'UTC')::date END`;
  const availability = `CASE
      WHEN ${e}.is_cancelled THEN 'cancelled'
      WHEN ${year} IS NULL THEN 'unknown'
      WHEN ${arrived} THEN 'released'
      ELSE 'upcoming'
    END`;
  return { start, end, instant, arrived, availability };
}

/** The editions a release's dates come from: published, not cancelled and with a date. */
export function datedEditionsSql(e: string, release: string): string {
  return `FROM editions ${e} JOIN editorial_entities ${e}_root ON ${e}_root.id = ${e}.editorial_entity_id
    WHERE ${e}.release_id = ${release} AND NOT ${e}.is_cancelled AND ${e}.release_year IS NOT NULL
      AND ${e}_root.publication_status = 'published'`;
}

/** SQL expressions over a `releases` row aliased `r`, for filters and sorts. */
export function releaseSql(r: string, now: string) {
  const e = `${r}_edition`;
  const { start, end, instant, arrived } = editionSql(e, now);
  const first = (column: string) => `(SELECT ${column} ${datedEditionsSql(e, `${r}.id`)} ORDER BY ${start}, ${instant} NULLS LAST, ${e}.id LIMIT 1)`;
  return {
    start: first(start),
    end: first(end),
    upcoming: `(EXISTS (SELECT 1 ${datedEditionsSql(e, `${r}.id`)}) AND NOT EXISTS (SELECT 1 ${datedEditionsSql(e, `${r}.id`)} AND ${arrived}))`,
  };
}

/**
 * The editions a recording's release date comes from: those with a track of
 * it, under the same rule as a release's.
 */
function editionsOfRecordingSql(e: string, recording: string): string {
  return `FROM editions ${e} JOIN editorial_entities ${e}_root ON ${e}_root.id = ${e}.editorial_entity_id
      JOIN tracks ${e}_track ON ${e}_track.edition_id = ${e}.id
    WHERE ${e}_track.recording_id = ${recording} AND NOT ${e}.is_cancelled AND ${e}.release_year IS NOT NULL
      AND ${e}_root.publication_status = 'published'`;
}

/**
 * SQL expressions over a `recordings` row aliased `rec`, for filters and
 * sorts: the first day of its release date and the year of it, null without one.
 */
export function recordingReleaseSql(rec: string) {
  const e = `${rec}_edition`;
  const { start, instant } = editionDateSql(e);
  const first = (column: string) => `(SELECT ${column} ${editionsOfRecordingSql(e, `${rec}.id`)} ORDER BY ${start}, ${instant} NULLS LAST, ${e}.id LIMIT 1)`;
  return { start: first(start), year: first(`${e}.release_year`) };
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
 * editions it is on, as a release's date is the earliest of its editions.
 * Future editions count; null without any.
 */
export async function recordingReleaseDates(manager: EntityManager, ids: number[]): Promise<Map<number, PartialDate | null>> {
  const dates = new Map<number, PartialDate | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return dates;
  const { start, instant } = editionDateSql('e');
  const rows: { recordingId: number; releaseYear: number; releaseMonth: number | null; releaseDay: number | null }[] = await manager.query(
    `SELECT DISTINCT ON (e_track.recording_id) e_track.recording_id AS "recordingId",
        e.release_year AS "releaseYear", e.release_month AS "releaseMonth", e.release_day AS "releaseDay"
      ${editionsOfRecordingSql('e', 'ANY($1)')}
      ORDER BY e_track.recording_id, ${start}, ${instant} NULLS LAST, e.id`,
    [ids],
  );
  for (const row of rows) dates.set(row.recordingId, partialDateResponse(row, 'release'));
  return dates;
}

/** The availability and instant of each edition, by id. */
export async function editionTimes(manager: EntityManager, ids: number[], now: Date): Promise<Map<number, EditionTimes>> {
  if (ids.length === 0) return new Map();
  const { instant, availability } = editionSql('e', '$2::timestamptz');
  const rows: { id: number; instant: Date | null; availability: EditionAvailability }[] = await manager.query(
    `SELECT e.id, ${instant} AS instant, ${availability} AS availability FROM editions e WHERE e.id = ANY($1)`,
    [ids, now],
  );
  return new Map(rows.map(({ id, instant: at, availability: state }) => [id, { instant: at && new Date(at), availability: state }]));
}

/** The dates of each release, by id. */
export async function releaseDates(manager: EntityManager, ids: number[], now: Date): Promise<Map<number, ReleaseDates>> {
  const dates = new Map<number, ReleaseDates>(ids.map((id) => [id, { releaseDate: null, upcoming: false, nextReleaseDate: null, releaseInstant: null }]));
  if (ids.length === 0) return dates;
  const { start, instant, arrived } = editionSql('e', '$2::timestamptz');
  const rows: { releaseId: number; releaseYear: number; releaseMonth: number | null; releaseDay: number | null; instant: Date | null; arrived: boolean }[] =
    await manager.query(
      `SELECT e.release_id AS "releaseId", e.release_year AS "releaseYear", e.release_month AS "releaseMonth", e.release_day AS "releaseDay",
          ${instant} AS instant, ${arrived} AS arrived
        FROM editions e JOIN editorial_entities root ON root.id = e.editorial_entity_id
        WHERE e.release_id = ANY($1) AND NOT e.is_cancelled AND e.release_year IS NOT NULL AND root.publication_status = 'published'
        ORDER BY ${start}, ${instant} NULLS LAST, e.id`,
      [ids, now],
    );
  for (const id of ids) {
    const own = rows.filter(({ releaseId }) => releaseId === id);
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
