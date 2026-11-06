import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { PartialPersonDates1793275200000 } from '../../src/database/migrations/1793275200000-PartialPersonDates';
import { currentTestDatabaseUrl } from '../support/console';

/*
 * The API cannot observe a migration, so this goes to the database: inside a
 * transaction it steps down to the previous schema, inserts rows the way that
 * schema held them and steps up. The rollback leaves the shared test database
 * as it was.
 */
describe('migration PartialPersonDates', () => {
  const migration = new PartialPersonDates1793275200000();
  let dataSource: DataSource;
  let runner: QueryRunner;

  beforeAll(async () => {
    dataSource = await new DataSource(databaseOptions(currentTestDatabaseUrl())).initialize();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    await migration.down(runner);
  });

  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** A person with the given extra columns, and returns the id of its identity. */
  async function insertPerson(columns: Record<string, unknown>): Promise<number> {
    const entityId = randomUUID();
    const [{ id: userId }] = await runner.query(
      `INSERT INTO users (uuid, username, email, display_name, created_at, updated_at, username_changed_at) VALUES ($1, $2, $3, 'Autora', now(), now(), now()) RETURNING id`,
      [randomUUID(), `u${entityId.slice(0, 8)}`, `${entityId}@example.com`],
    );
    await runner.query(`INSERT INTO editorial_entities (id, entity_type, created_by, created_at) VALUES ($1, 'identity', $2, now())`, [entityId, userId]);
    const [{ id }] = await runner.query(
      `INSERT INTO catalog_identities (uuid, public_id, display_name, type, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Persona', 'person', now(), now(), $3) RETURNING id`,
      [randomUUID(), entityId.replaceAll('-', '').slice(0, 21), entityId],
    );
    const names = Object.keys(columns);
    await runner.query(
      `INSERT INTO people (catalog_identity_id${names.map((name) => `, ${name}`).join('')}) VALUES ($1${names.map((_, index) => `, $${index + 2}`).join('')})`,
      [id, ...Object.values(columns)],
    );
    return id;
  }

  const person = async (id: number) => (await runner.query(`SELECT * FROM people WHERE catalog_identity_id = $1`, [id]))[0];

  it('copies complete dates and keeps empty ones empty', async () => {
    const complete = await insertPerson({ birth_date: '1782-10-27', death_date: '1840-05-27' });
    const leapDay = await insertPerson({ birth_date: '1992-02-29' });
    const unknown = await insertPerson({});

    await migration.up(runner);

    expect(await person(complete)).toEqual(
      expect.objectContaining({ birth_year: 1782, birth_month: 10, birth_day: 27, death_year: 1840, death_month: 5, death_day: 27 }),
    );
    expect(await person(leapDay)).toEqual(
      expect.objectContaining({ birth_year: 1992, birth_month: 2, birth_day: 29, death_year: null, death_month: null, death_day: null }),
    );
    expect(await person(unknown)).toEqual(
      expect.objectContaining({ birth_year: null, birth_month: null, birth_day: null, death_year: null, death_month: null, death_day: null }),
    );
  });

  it('replaces the date columns and the lifespan constraint', async () => {
    const id = await insertPerson({});

    await migration.up(runner);

    expect(Object.keys(await person(id))).not.toEqual(expect.arrayContaining(['birth_date']));
    expect(Object.keys(await person(id))).not.toEqual(expect.arrayContaining(['death_date']));
    await runner.query(`UPDATE people SET birth_year = 2000, birth_month = 4, death_year = 2000, death_month = 3 WHERE catalog_identity_id = $1`, [id]);
  });

  it('accepts a birthday and refuses a month alone', async () => {
    const id = await insertPerson({});
    await migration.up(runner);

    await runner.query(`UPDATE people SET birth_month = 2, birth_day = 29 WHERE catalog_identity_id = $1`, [id]);

    await runner.query('SAVEPOINT refused');
    await expect(runner.query(`UPDATE people SET birth_day = NULL WHERE catalog_identity_id = $1`, [id])).rejects.toThrow('people_birth_date');
    await runner.query('ROLLBACK TO SAVEPOINT refused');
    await expect(runner.query(`UPDATE people SET birth_month = 2, birth_day = 30 WHERE catalog_identity_id = $1`, [id])).rejects.toThrow('people_birth_date');
  });

  it('going down keeps only complete dates', async () => {
    const complete = await insertPerson({ birth_date: '1993-05-16', death_date: '2020-01-02' });
    const partial = await insertPerson({});
    await migration.up(runner);
    await runner.query(`UPDATE people SET birth_month = 3, birth_day = 14, death_year = 2020 WHERE catalog_identity_id = $1`, [partial]);

    await migration.down(runner);

    const dates = async (id: number) =>
      (await runner.query(`SELECT birth_date::text, death_date::text FROM people WHERE catalog_identity_id = $1`, [id]))[0];
    expect(await dates(complete)).toEqual({ birth_date: '1993-05-16', death_date: '2020-01-02' });
    expect(await dates(partial)).toEqual({ birth_date: null, death_date: null });
    await migration.up(runner);
  });
});
