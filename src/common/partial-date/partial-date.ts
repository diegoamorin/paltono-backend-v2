import { ApiProperty } from '@nestjs/swagger';
import { FindOperator, IsNull } from 'typeorm';

/*
 * A partial date: a year, optionally its month, and with that optionally its
 * day, kept in three columns named after one prefix (`joinedYear`,
 * `joinedMonth`, `joinedDay`; `joined_year` and so on in SQL).
 *
 * It has two shapes. Payloads and revisions leave out what is unknown
 * (`PartialDateValue`); API responses mark it with nulls (`PartialDate`). It
 * stands for the interval from its first possible day to its last, so of two
 * partial dates only one wholly before the other is certainly earlier.
 *
 * A birth is a partial date or a birthday, its month and day without a year,
 * which recurs every year and so means no interval to compare.
 */

/** A partial date as payloads propose it and revisions record it. */
export interface PartialDateValue {
  year: number;
  month?: number;
  day?: number;
}

/** A birth as payloads propose it and revisions record it. */
export type BirthValue = PartialDateValue | { year?: undefined; month: number; day: number };

/** A partial date as API responses show it. */
export class PartialDate {
  @ApiProperty({ example: 2008 })
  year: number;

  @ApiProperty({ type: Number, nullable: true, example: 9 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  day: number | null;
}

/** A birth as API responses show it. */
export class BirthDate {
  @ApiProperty({ type: Number, nullable: true, example: 1993, description: 'null en un cumpleaños sin año' })
  year: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 16 })
  day: number | null;
}

type ColumnsOf<Prefix extends string, Value> = Record<`${Prefix}Year` | `${Prefix}Month` | `${Prefix}Day`, Value>;

/** Without a year a day is judged against a leap year, so February 29 is a birthday. */
const LEAP_YEAR = 2000;

/** Whether its day exists in its month; a date without a day has none to miss. */
export function isRealDay({ year, month, day }: BirthValue): boolean {
  return day === undefined || month === undefined || day <= daysInMonth(year ?? LEAP_YEAR, month);
}

/** A birth as a date to compare with others; a birthday has no year, so it compares with nothing. */
export function datedBirth(birth: BirthValue | null | undefined): PartialDateValue | null {
  return birth?.year === undefined ? null : birth;
}

/** The first and last days a partial date may mean, as comparable `YYYYMMDD` numbers. */
export function partialDateInterval({ year, month, day }: PartialDateValue): { first: number; last: number } {
  const at = (m: number, d: number) => year * 10_000 + m * 100 + d;
  if (month === undefined) return { first: at(1, 1), last: at(12, 31) };
  if (day === undefined) return { first: at(month, 1), last: at(month, daysInMonth(year, month)) };
  return { first: at(month, day), last: at(month, day) };
}

/** Whether every day `a` may mean comes before every day `b` may mean. */
export function isWhollyBefore(a: PartialDateValue, b: PartialDateValue): boolean {
  return partialDateInterval(a).last < partialDateInterval(b).first;
}

export function samePartialDate(a: PartialDateValue | null, b: PartialDateValue | null): boolean {
  return a?.year === b?.year && a?.month === b?.month && a?.day === b?.day;
}

/** The columns that store a partial date; without one they are all null. */
export function partialDateColumns<Prefix extends string>(prefix: Prefix, date: BirthValue | null | undefined): ColumnsOf<Prefix, number | null> {
  return {
    [`${prefix}Year`]: date?.year ?? null,
    [`${prefix}Month`]: date?.month ?? null,
    [`${prefix}Day`]: date?.day ?? null,
  } as ColumnsOf<Prefix, number | null>;
}

/** The conditions of a find by a partial date, which match unknown components with NULL. */
export function partialDateLookup<Prefix extends string>(prefix: Prefix, date: PartialDateValue | null): ColumnsOf<Prefix, number | FindOperator<number>> {
  const column = (value: number | undefined) => value ?? IsNull();
  return {
    [`${prefix}Year`]: column(date?.year),
    [`${prefix}Month`]: column(date?.month),
    [`${prefix}Day`]: column(date?.day),
  } as ColumnsOf<Prefix, number | FindOperator<number>>;
}

/** The order of a find by a partial date, ascending: unknown dates last, and a less precise date before the more precise ones within it. */
export function partialDateOrder<Prefix extends string>(prefix: Prefix) {
  return {
    [`${prefix}Year`]: { direction: 'ASC', nulls: 'LAST' },
    [`${prefix}Month`]: { direction: 'ASC', nulls: 'FIRST' },
    [`${prefix}Day`]: { direction: 'ASC', nulls: 'FIRST' },
  } as ColumnsOf<Prefix, { direction: 'ASC'; nulls: 'LAST' | 'FIRST' }>;
}

/** What a row's columns store, as a payload would propose it. */
export function partialDateValue<Prefix extends string>(row: ColumnsOf<Prefix, number | null>, prefix: Prefix): PartialDateValue | null {
  const shown = partialDateResponse(row, prefix);
  if (shown === null) return null;
  const { year, month, day } = shown;
  return { year, ...(month !== null ? { month } : {}), ...(day !== null ? { day } : {}) };
}

/** What a row's columns store, as an API response shows it. */
export function partialDateResponse<Prefix extends string>(row: ColumnsOf<Prefix, number | null>, prefix: Prefix): PartialDate | null {
  const [year, month, day] = [row[`${prefix}Year`], row[`${prefix}Month`], row[`${prefix}Day`]];
  return year === null ? null : { year, month, day };
}

/** What a person's birth columns store, as a payload would propose it. */
export function birthValue(row: ColumnsOf<'birth', number | null>): BirthValue | null {
  const shown = birthResponse(row);
  if (shown?.year === null) return { month: shown.month!, day: shown.day! };
  return partialDateValue(row, 'birth');
}

/** What a person's birth columns store, as an API response shows it; a birthday has a null year. */
export function birthResponse({ birthYear: year, birthMonth: month, birthDay: day }: ColumnsOf<'birth', number | null>): BirthDate | null {
  return year === null && month === null ? null : { year, month, day };
}

/** The check constraint of a partial date's columns, as the migrations wrote it, so `migration:generate` finds no drift. */
export const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/** The check constraint of a person's birth: a partial date, or a month and day without a year, judged against a leap year. */
export const birthDateCheck = `(birth_year IS NULL OR birth_year BETWEEN 1 AND 9999) AND (birth_month IS NULL OR birth_month BETWEEN 1 AND 12) AND (birth_day IS NULL OR (birth_month IS NOT NULL AND birth_day BETWEEN 1 AND extract(day FROM make_date(coalesce(birth_year, ${LEAP_YEAR}), birth_month, 1) + interval '1 month - 1 day'))) AND (birth_year IS NOT NULL OR birth_month IS NULL OR birth_day IS NOT NULL)`;

/** SQL expressions of the first and last days a partial date may mean, over the row aliased `row`. */
export function partialDateIntervalSql(row: string, prefix: string) {
  const [year, month, day] = [`${row}.${prefix}_year`, `${row}.${prefix}_month`, `${row}.${prefix}_day`];
  return {
    start: `CASE WHEN ${year} IS NOT NULL THEN make_date(${year}, coalesce(${month}, 1), coalesce(${day}, 1)) END`,
    end: `CASE
      WHEN ${day} IS NOT NULL THEN make_date(${year}, ${month}, ${day})
      WHEN ${month} IS NOT NULL THEN (make_date(${year}, ${month}, 1) + interval '1 month - 1 day')::date
      WHEN ${year} IS NOT NULL THEN make_date(${year}, 12, 31)
    END`,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
