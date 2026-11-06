import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { BirthDate } from '../common/partial-date/partial-date';
import { ANNIVERSARY_KINDS, AnniversaryEntry, AnniversaryKind } from './anniversary.resource';
import { artistProfileCondition, identityEntriesById } from './identities.service';

/** The table and column prefix of the date behind each kind; every table keys on `catalog_identity_id`. */
const SOURCES: Record<AnniversaryKind, { table: string; prefix: string }> = {
  birth: { table: 'people', prefix: 'birth' },
  death: { table: 'people', prefix: 'death' },
  debut: { table: 'artists', prefix: 'debut' },
  founding: { table: 'organizations', prefix: 'founding' },
  dissolution: { table: 'organizations', prefix: 'dissolution' },
};

interface AnniversaryRow extends BirthDate {
  kind: AnniversaryKind;
  identity_id: number;
}

const numbersUpTo = (last: number) => Array.from({ length: last }, (_, index) => String(index + 1));

/** The dates of published identities, one row per date whose month is known. */
@Injectable()
export class AnniversariesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: CollectionQuery): Promise<{ entries: AnniversaryEntry[]; total: number }> {
    const { month, day, kind, deceased, hasArtistProfile } = query.filter;
    if (month !== undefined) requireOneOf('filter[month]', month, numbersUpTo(12));
    if (day !== undefined) {
      requireOneOf('filter[day]', day, numbersUpTo(31));
      if (month === undefined) {
        throw new JsonApiException(HttpStatus.BAD_REQUEST, [{ detail: 'filter[day] requires filter[month]', source: { parameter: 'filter[day]' } }]);
      }
    }
    const conditions = [`root.publication_status = 'published'`, '($1::smallint IS NULL OR anniversary.month = $1)', '($2::smallint IS NULL OR anniversary.day = $2)'];
    if (deceased !== undefined) {
      requireOneOf('filter[deceased]', deceased, ['true', 'false']);
      // A death known only by its year has no row, but the person is just as deceased.
      const died = deceased === 'true' ? 'EXISTS' : 'NOT EXISTS';
      conditions.push(`${died} (SELECT 1 FROM people person WHERE person.catalog_identity_id = identity.id AND person.death_year IS NOT NULL)`);
    }
    if (hasArtistProfile !== undefined) conditions.push(artistProfileCondition(hasArtistProfile));

    const anniversaries = `
      FROM (${datesOf(kindsOf(kind))}) anniversary
      JOIN catalog_identities identity ON identity.id = anniversary.identity_id
      JOIN editorial_entities root ON root.id = identity.editorial_entity_id
      WHERE ${conditions.join(' AND ')}`;
    const parameters = [month ?? null, day ?? null];
    const manager = this.dataSource.manager;
    const [{ total }] = await manager.query(`SELECT count(*)::int AS total ${anniversaries}`, parameters);
    const { skip, take } = pageWindow(query);
    const page: AnniversaryRow[] = await manager.query(
      `SELECT anniversary.* ${anniversaries}
      ORDER BY anniversary.month, anniversary.day NULLS LAST, identity.display_name, anniversary.kind, identity.public_id
      OFFSET $3 LIMIT $4`,
      [...parameters, skip, take],
    );
    const entries = await identityEntriesById(manager, page.map(({ identity_id }) => identity_id));
    return {
      entries: page.map(({ kind, year, month, day, identity_id }) => ({ kind, date: { year, month, day }, identity: entries.get(identity_id)! })),
      total,
    };
  }
}

/** The kinds a `filter[kind]` asks for, each once, or all of them without the filter. */
function kindsOf(filter: string | undefined): readonly AnniversaryKind[] {
  if (filter === undefined) return ANNIVERSARY_KINDS;
  const requested = filter.split(',');
  for (const kind of requested) requireOneOf('filter[kind]', kind, ANNIVERSARY_KINDS);
  return ANNIVERSARY_KINDS.filter((kind) => requested.includes(kind));
}

/** The dates of the given kinds whose month is known; only those recur every year. */
function datesOf(kinds: readonly AnniversaryKind[]): string {
  return kinds
    .map((kind) => {
      const { table, prefix } = SOURCES[kind];
      return `
      SELECT '${kind}' AS kind, catalog_identity_id AS identity_id, ${prefix}_year AS year, ${prefix}_month AS month, ${prefix}_day AS day
      FROM ${table}
      WHERE ${prefix}_month IS NOT NULL`;
    })
    .join(' UNION ALL ');
}
