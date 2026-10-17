import { otherDatabaseUrl, queryTestDatabase, runPnpm } from '../support/console';

jest.setTimeout(120_000);

const testDatabaseUrl = () => process.env.DATABASE_URL_TEST!;

/** Points the development commands at the test database. */
const asDevelopment = () => ({ NODE_ENV: 'development', DATABASE_URL: testDatabaseUrl() });

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

describe('pnpm db:test:prepare', () => {
  it('recreates the test database from the migrations', async () => {
    await queryTestDatabase('CREATE TABLE leftover (id int)');

    const result = await runPnpm(['db:test:prepare']);

    expect(result).toMatchObject({ status: 0 });
    expect(await queryTestDatabase("SELECT to_regclass('leftover') AS leftover")).toEqual([{ leftover: null }]);
    expect(await migrationNames()).toContain('EnableSearchExtensions1792195200000');
  });

  it('refuses a database whose name does not end in _test', async () => {
    const result = await runPnpm(['db:test:prepare'], { DATABASE_URL_TEST: otherDatabaseUrl('paltono_dev') });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must end in _test/);
  });

  it('refuses the development database even when its name ends in _test', async () => {
    const result = await runPnpm(['db:test:prepare'], { DATABASE_URL: testDatabaseUrl() });

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
