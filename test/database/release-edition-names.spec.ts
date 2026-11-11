import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { currentTestDatabaseUrl } from '../support/console';

/*
 * A person or an AI reading the database counts albums in `releases`, so the
 * schema must call the launch a release and the edition an edition (ADR 0010).
 * Only the release date columns of an edition keep `release` in their name,
 * because there it means the date it came out.
 */
describe('release and edition names in the schema', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await new DataSource(databaseOptions(currentTestDatabaseUrl())).initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function names(sql: string): Promise<string[]> {
    const rows: { name: string }[] = await dataSource.query(sql);
    return rows.map((row) => row.name).sort();
  }

  /** Every table, index, sequence, type, constraint and column name of the public schema. */
  async function schemaNames(): Promise<string[]> {
    return names(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
      UNION SELECT con.conname FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = 'public'
      UNION SELECT c.relname || '.' || a.attname FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    `);
  }

  /** The table and column a foreign key column points to. */
  async function reference(table: string, column: string): Promise<string> {
    const [row] = await dataSource.query(
      `SELECT target.relname || '.' || target_column.attname AS name
       FROM pg_constraint con
       JOIN pg_class source ON source.oid = con.conrelid
       JOIN pg_attribute source_column ON source_column.attrelid = con.conrelid AND source_column.attnum = con.conkey[1]
       JOIN pg_class target ON target.oid = con.confrelid
       JOIN pg_attribute target_column ON target_column.attrelid = con.confrelid AND target_column.attnum = con.confkey[1]
       WHERE con.contype = 'f' AND source.relname = $1 AND source_column.attname = $2`,
      [table, column],
    );
    return row?.name;
  }

  it('names nothing after a release group', async () => {
    expect((await schemaNames()).filter((name) => name.includes('release_group'))).toEqual([]);
  });

  it('points each edition to its release, and each track and edition credit to its edition', async () => {
    expect(await reference('editions', 'release_id')).toBe('releases.id');
    expect(await reference('release_artist_credits', 'release_id')).toBe('releases.id');
    expect(await reference('tracks', 'edition_id')).toBe('editions.id');
    expect(await reference('edition_contributions', 'edition_id')).toBe('editions.id');
  });

  it('types a release with release_type', async () => {
    const [{ type }] = await dataSource.query(
      `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'releases'::regclass AND attname = 'type'`,
    );
    expect(type).toBe('release_type');
  });

  it('keeps release only in the release date and the release of what belongs to an edition', async () => {
    const editionNames = (await schemaNames()).filter((name) => /^(editions|edition_contributions|tracks)[._]/.test(name));
    expect(editionNames.filter((name) => name.replace(/^[a-z_]+\./, '').includes('release'))).toEqual([
      'editions.release_day',
      'editions.release_id',
      'editions.release_month',
      'editions.release_time',
      'editions.release_year',
      'editions_release_date',
      'editions_release_id_edition_name_key',
      'editions_release_id_fkey',
      'editions_release_id_not_null',
      'editions_release_time',
    ]);
  });
});
