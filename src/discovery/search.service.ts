import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ARTIST_SEARCH, IDENTITY_SEARCH } from '../catalog-identities/identity-search';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery } from '../common/json-api/query';
import { SearchSource } from '../common/search/search-source';
import { containsPattern } from '../database/like-pattern';
import { EVENT_SEARCH, TOUR_SEARCH } from '../live-events/live-event-search';
import { RECORDING_SEARCH, RELEASE_GROUP_SEARCH, WORK_SEARCH } from '../music/music-search';

/*
 * Global search (S1): one heterogeneous list of published entries of the
 * catalog whose names, aliases or titles match a text, by relevance. Matching
 * ignores case and accents (`unaccent`) and has no transliteration: a text
 * contained in a name matches it, Korean included, and otherwise a close
 * enough spelling (`pg_trgm` word similarity) tolerates typing errors.
 * Discovery only reads through the search sources of each module.
 */

export const SOURCES: SearchSource[] = [IDENTITY_SEARCH, ARTIST_SEARCH, WORK_SEARCH, RECORDING_SEARCH, RELEASE_GROUP_SEARCH, EVENT_SEARCH, TOUR_SEARCH];

/**
 * The types searched without `filter[type]`. An artist profile is part of its
 * identity's entry, so it is only searched when asked for: otherwise every
 * artist would appear twice.
 */
const DEFAULT_TYPES = SOURCES.map(({ type }) => type).filter((type) => type !== 'artists');

/** The least word similarity a name needs to match a text it does not contain. */
const MIN_SIMILARITY = 0.5;

@Injectable()
export class SearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async search(query: CollectionQuery): Promise<{ results: { schema: SearchSource['schema']; model: unknown }[]; total: number }> {
    const q = query.filter.q?.trim();
    if (!q) throw badParameter('filter[q]', 'filter[q] is required and must not be blank');
    const sources = this.sourcesOf(query.filter.type);

    const texts = sources.map(({ type, textsSql }, index) => `SELECT '${type}'::text AS type, ${index} AS rank, texts.id, texts.text FROM (${textsSql}) texts`);
    const normalized = 'lower(unaccent(candidate.text))';
    const scored = `
      SELECT candidate.type, candidate.rank, candidate.id,
        max(CASE WHEN ${normalized} LIKE $2 THEN 1 + similarity($1, ${normalized}) ELSE word_similarity($1, ${normalized}) END) AS score
      FROM (${texts.join(' UNION ALL ')}) candidate
      WHERE ${normalized} LIKE $2 OR word_similarity($1, ${normalized}) >= ${MIN_SIMILARITY}
      GROUP BY candidate.type, candidate.rank, candidate.id`;
    const direction = query.sort.find(({ field }) => field === 'relevance')?.direction ?? 'DESC';
    const { skip, take } = pageWindow(query);
    const manager = this.dataSource.manager;
    // The text is normalized like the names, so its LIKE pattern escapes what it will compare.
    const [{ needle }]: { needle: string }[] = await manager.query('SELECT lower(unaccent($1)) AS needle', [q]);
    const parameters = [needle, containsPattern(needle)];

    const [{ total }] = await manager.query(`SELECT count(*)::int AS total FROM (${scored}) results`, parameters);
    const page: { type: string; id: string }[] = await manager.query(
      `SELECT type, id FROM (${scored}) results ORDER BY score ${direction}, rank, length(id), id LIMIT ${take} OFFSET ${skip}`,
      parameters,
    );

    const now = this.clock.now();
    const loaded = new Map<string, unknown>();
    for (const source of sources) {
      const ids = page.filter(({ type }) => type === source.type).map(({ id }) => id);
      if (ids.length === 0) continue;
      const models = await source.load(manager, ids, now);
      ids.forEach((id, index) => loaded.set(`${source.type}:${id}`, models[index]));
    }
    const results = page.map(({ type, id }) => ({ schema: sources.find((source) => source.type === type)!.schema, model: loaded.get(`${type}:${id}`) }));
    return { results, total };
  }

  private sourcesOf(type: string | undefined): SearchSource[] {
    if (type === undefined) return SOURCES.filter((source) => DEFAULT_TYPES.includes(source.type));
    const requested = type.split(',');
    const unknown = requested.filter((name) => !SOURCES.some((source) => source.type === name));
    if (unknown.length > 0) {
      throw badParameter('filter[type]', `filter[type] must list types among: ${SOURCES.map((source) => source.type).join(', ')}`);
    }
    return SOURCES.filter((source) => requested.includes(source.type));
  }
}

function badParameter(parameter: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.BAD_REQUEST, [{ detail, source: { parameter } }]);
}
