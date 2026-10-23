import { databaseName, testDatabaseUrl } from '../../src/database/test-database-url';
import {
  currentTestDatabaseUrl,
  databaseExists,
  otherDatabaseUrl,
  queryDatabase,
  queryTestDatabase,
  runPnpm,
} from '../support/console';

jest.setTimeout(120_000);

/** Points the development commands at the test database. */
const asDevelopment = () => ({ NODE_ENV: 'development', DATABASE_URL: currentTestDatabaseUrl() });

const migrationNames = async () =>
  (await queryTestDatabase<{ name: string }>('SELECT name FROM migrations ORDER BY id')).map((row) => row.name);

describe('pnpm db:reset', () => {
  beforeEach(async () => {
    await queryTestDatabase(`
      CREATE TABLE IF NOT EXISTS reset_probe (id serial PRIMARY KEY, label text NOT NULL);
      INSERT INTO reset_probe (label) VALUES ('first'), ('second');
    `);
  });

  afterAll(async () => {
    await queryTestDatabase('DROP TABLE IF EXISTS reset_probe');
  });

  it('empties every table but keeps the tables and the migration history', async () => {
    const migrationsBefore = await migrationNames();

    const result = await runPnpm(['db:reset'], asDevelopment());

    expect(result).toMatchObject({ status: 0 });
    expect(await queryTestDatabase('SELECT * FROM reset_probe')).toEqual([]);
    expect(await migrationNames()).toEqual(migrationsBefore);
    await queryTestDatabase("INSERT INTO reset_probe (label) VALUES ('after')");
    expect(await queryTestDatabase('SELECT id FROM reset_probe')).toEqual([{ id: 1 }]);
  });

  it.each(['production', 'test'])('refuses to run when NODE_ENV is %s', async (environment) => {
    const result = await runPnpm(['db:reset'], { ...asDevelopment(), NODE_ENV: environment });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/only in development/);
    expect(await queryTestDatabase('SELECT label FROM reset_probe')).not.toEqual([]);
  });
});

describe('pnpm db:rebuild', () => {
  jest.setTimeout(600_000);

  const columnExists = async (table: string, column: string) =>
    (
      await queryTestDatabase(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column],
      )
    ).length > 0;
  const accountCount = async () => Number((await queryTestDatabase<{ n: string }>('SELECT count(*) AS n FROM users'))[0].n);

  afterAll(async () => {
    // Leave the other specs an empty database, as they expect.
    await runPnpm(['db:reset'], asDevelopment());
  });

  it('migrates and seeds the database again, even when the existing migrations changed since they ran', async () => {
    const applied = await migrationNames();
    // As if a migration that already ran had since been edited to add this column.
    await queryTestDatabase('ALTER TABLE users DROP COLUMN avatar_url');
    await queryTestDatabase('CREATE TABLE IF NOT EXISTS rebuild_probe (id int)');

    const result = await runPnpm(['db:rebuild'], asDevelopment());

    expect(result).toMatchObject({ status: 0 });
    expect(await columnExists('users', 'avatar_url')).toBe(true);
    expect(await queryTestDatabase("SELECT to_regclass('rebuild_probe') AS probe")).toEqual([{ probe: null }]);
    expect(await migrationNames()).toEqual(applied);
    expect(await accountCount()).toBeGreaterThan(0);
  });

  it.each(['production', 'test'])('refuses to run when NODE_ENV is %s', async (environment) => {
    await queryTestDatabase('CREATE TABLE IF NOT EXISTS rebuild_probe (id int)');

    const result = await runPnpm(['db:rebuild'], { ...asDevelopment(), NODE_ENV: environment });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/only in development/);
    expect(await queryTestDatabase("SELECT to_regclass('rebuild_probe')::text AS probe")).toEqual([{ probe: 'rebuild_probe' }]);
    await queryTestDatabase('DROP TABLE rebuild_probe');
  });
});

describe('pnpm db:test:prepare', () => {
  it('recreates the test database from the migrations', async () => {
    await queryTestDatabase('CREATE TABLE leftover (id int)');

    const result = await runPnpm(['db:test:prepare']);

    expect(result).toMatchObject({ status: 0 });
    expect(await queryTestDatabase("SELECT to_regclass('leftover') AS leftover")).toEqual([{ leftover: null }]);
    expect(await migrationNames()).toContain('EnableSearchExtensions1792195200000');
  });

  describe('when the test database does not exist', () => {
    // The command adds this checkout's worktree suffix, if any, to the configured name.
    const configured = otherDatabaseUrl('paltono_missing_test');
    const effective = testDatabaseUrl({ DATABASE_URL_TEST: configured })!;
    const missingDevelopment = 'paltono_missing_dev';

    afterEach(async () => {
      for (const database of [databaseName(effective), missingDevelopment]) {
        await queryTestDatabase(`DROP DATABASE IF EXISTS "${database}"`);
      }
    });

    it('creates it on the same server and migrates it', async () => {
      const result = await runPnpm(['db:test:prepare'], { DATABASE_URL_TEST: configured });

      expect(result).toMatchObject({ status: 0 });
      const migrations = await queryDatabase<{ name: string }>(effective, 'SELECT name FROM migrations');
      expect(migrations.map((row) => row.name)).toContain('EnableSearchExtensions1792195200000');
    });

    it('refuses a name not ending in _test before creating anything', async () => {
      const result = await runPnpm(['db:test:prepare'], { DATABASE_URL_TEST: otherDatabaseUrl(missingDevelopment) });

      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/must end in _test/);
      expect(await databaseExists(missingDevelopment)).toBe(false);
    });

    it('refuses the development database before creating anything', async () => {
      const result = await runPnpm(['db:test:prepare'], { DATABASE_URL_TEST: configured, DATABASE_URL: effective });

      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/points to DATABASE_URL/);
      expect(await databaseExists(databaseName(effective))).toBe(false);
    });
  });

  it('refuses a database whose name does not end in _test', async () => {
    const result = await runPnpm(['db:test:prepare'], { DATABASE_URL_TEST: otherDatabaseUrl('paltono_dev') });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must end in _test/);
  });

  it('refuses the development database even when its name ends in _test', async () => {
    const result = await runPnpm(['db:test:prepare'], { DATABASE_URL: currentTestDatabaseUrl() });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/points to DATABASE_URL/);
  });
});

describe('migration commands', () => {
  it('reverts and runs the migrations', async () => {
    const applied = await migrationNames();

    expect(await runPnpm(['migration:revert'], asDevelopment())).toMatchObject({ status: 0 });
    expect(await migrationNames()).toEqual(applied.slice(0, -1));

    expect(await runPnpm(['migration:run'], asDevelopment())).toMatchObject({ status: 0 });
    expect(await migrationNames()).toEqual(applied);
  });

  it('generates no migration when the entities match the schema', async () => {
    const result = await runPnpm(['migration:generate', 'src/database/migrations/Drift', '--check'], asDevelopment());

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/No changes in database schema were found/);
  });
});
