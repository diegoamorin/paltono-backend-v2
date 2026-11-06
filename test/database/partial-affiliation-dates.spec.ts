import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { PartialAffiliationDates1793361600000 } from '../../src/database/migrations/1793361600000-PartialAffiliationDates';
import { currentTestDatabaseUrl } from '../support/console';

/*
 * The API cannot observe a migration, so this goes to the database: inside a
 * transaction it steps down to the previous schema, inserts rows the way that
 * schema held them and steps up. The rollback leaves the shared test database
 * as it was.
 */
describe('migration PartialAffiliationDates', () => {
  const migration = new PartialAffiliationDates1793361600000();
  let dataSource: DataSource;
  let runner: QueryRunner;
  let artistId: number;
  let organizationId: number;

  beforeAll(async () => {
    dataSource = await new DataSource(databaseOptions(currentTestDatabaseUrl())).initialize();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    await migration.down(runner);
    const [{ id: userId }] = await runner.query(
      `INSERT INTO users (uuid, username, email, display_name, created_at, updated_at, username_changed_at)
       VALUES ($1, 'autora', 'autora@example.com', 'Autora', now(), now(), now()) RETURNING id`,
      [randomUUID()],
    );
    const artistIdentity = await insertIdentity(userId, 'person');
    organizationId = await insertIdentity(userId, 'organization');
    await runner.query(`INSERT INTO organizations (catalog_identity_id) VALUES ($1)`, [organizationId]);
    [{ id: artistId }] = await runner.query(
      `INSERT INTO artists (uuid, public_id, catalog_identity_id, created_at, updated_at) VALUES ($1, 'artista', $2, now(), now()) RETURNING id`,
      [randomUUID(), artistIdentity],
    );
  });

  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function insertIdentity(userId: number, type: string): Promise<number> {
    const entityId = randomUUID();
    await runner.query(`INSERT INTO editorial_entities (id, entity_type, created_by, created_at) VALUES ($1, 'identity', $2, now())`, [entityId, userId]);
    const [{ id }] = await runner.query(
      `INSERT INTO catalog_identities (uuid, public_id, display_name, type, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Identidad', $3, now(), now(), $4) RETURNING id`,
      [randomUUID(), entityId.replaceAll('-', '').slice(0, 21), type, entityId],
    );
    return id;
  }

  /** An affiliation with the given extra columns, and returns its id. */
  async function insertAffiliation(columns: Record<string, unknown>, relationshipType = 'agency'): Promise<number> {
    const names = Object.keys(columns);
    const [{ id }] = await runner.query(
      `INSERT INTO artist_organization_affiliations (artist_id, organization_id, relationship_type, status, created_at, updated_at${names.map((name) => `, ${name}`).join('')})
       VALUES ($1, $2, $3, 'former', now(), now()${names.map((_, index) => `, $${index + 4}`).join('')}) RETURNING id`,
      [artistId, organizationId, relationshipType, ...Object.values(columns)],
    );
    return id;
  }

  const affiliation = async (id: number) => (await runner.query(`SELECT * FROM artist_organization_affiliations WHERE id = $1`, [id]))[0];

  /** Runs a statement the schema must refuse, and leaves the transaction usable. */
  async function expectRefused(sql: string, constraint: string): Promise<void> {
    await runner.query('SAVEPOINT refused');
    await expect(runner.query(sql)).rejects.toThrow(constraint);
    await runner.query('ROLLBACK TO SAVEPOINT refused');
  }

  it('copies complete dates and keeps empty ones empty', async () => {
    const complete = await insertAffiliation({ started_at: '2008-09-18', ended_at: '2024-02-29' });
    const open = await insertAffiliation({ started_at: '2010-01-02' });
    const unknown = await insertAffiliation({});

    await migration.up(runner);

    expect(await affiliation(complete)).toEqual(
      expect.objectContaining({ started_year: 2008, started_month: 9, started_day: 18, ended_year: 2024, ended_month: 2, ended_day: 29 }),
    );
    expect(await affiliation(open)).toEqual(
      expect.objectContaining({ started_year: 2010, started_month: 1, started_day: 2, ended_year: null, ended_month: null, ended_day: null }),
    );
    expect(await affiliation(unknown)).toEqual(
      expect.objectContaining({ started_year: null, started_month: null, started_day: null, ended_year: null, ended_month: null, ended_day: null }),
    );
  });

  it('replaces the date columns and the interval constraint', async () => {
    const id = await insertAffiliation({});

    await migration.up(runner);

    expect(Object.keys(await affiliation(id))).not.toEqual(expect.arrayContaining(['started_at']));
    expect(Object.keys(await affiliation(id))).not.toEqual(expect.arrayContaining(['ended_at']));
    await runner.query(`UPDATE artist_organization_affiliations SET started_year = 2020, started_month = 4, ended_year = 2020, ended_month = 3 WHERE id = ${id}`);
  });

  it('refuses a date that cannot exist', async () => {
    const id = await insertAffiliation({});
    await migration.up(runner);
    const update = (columns: string) => `UPDATE artist_organization_affiliations SET ${columns} WHERE id = ${id}`;

    await expectRefused(update('started_year = 2023, started_month = 2, started_day = 29'), 'artist_organization_affiliations_started_date');
    await expectRefused(update('ended_month = 2'), 'artist_organization_affiliations_ended_date');
  });

  it('keeps the status coherent with a known end, by its year', async () => {
    const id = await insertAffiliation({});
    await migration.up(runner);

    await runner.query(`UPDATE artist_organization_affiliations SET ended_year = 2020 WHERE id = ${id}`);
    await expectRefused(`UPDATE artist_organization_affiliations SET status = 'current' WHERE id = ${id}`, 'artist_organization_affiliations_status');
    await expectRefused(`UPDATE artist_organization_affiliations SET status = 'unknown' WHERE id = ${id}`, 'artist_organization_affiliations_status');
  });

  it('keeps two affiliations from sharing organization, type and start, also an unknown one', async () => {
    const first = await insertAffiliation({}, 'agency');
    const second = await insertAffiliation({}, 'label');
    await migration.up(runner);
    const relabel = (id: number, start: string) =>
      `UPDATE artist_organization_affiliations SET relationship_type = 'label', ${start} WHERE id = ${id}`;

    await expectRefused(relabel(first, 'started_year = NULL'), 'artist_organization_affiliations_period_key');

    await runner.query(`UPDATE artist_organization_affiliations SET started_year = 2020 WHERE id IN (${first}, ${second})`);
    await expectRefused(relabel(first, 'started_year = 2020'), 'artist_organization_affiliations_period_key');
    await runner.query(relabel(first, 'started_year = 2020, started_month = 3'));
  });

  it('going down keeps only complete dates', async () => {
    const complete = await insertAffiliation({ started_at: '2008-09-18', ended_at: '2024-12-31' });
    const partial = await insertAffiliation({}, 'label');
    await migration.up(runner);
    await runner.query(`UPDATE artist_organization_affiliations SET started_year = 2020, started_month = 3, ended_year = 2021 WHERE id = ${partial}`);

    await migration.down(runner);

    const dates = async (id: number) =>
      (await runner.query(`SELECT started_at::text, ended_at::text FROM artist_organization_affiliations WHERE id = $1`, [id]))[0];
    expect(await dates(complete)).toEqual({ started_at: '2008-09-18', ended_at: '2024-12-31' });
    expect(await dates(partial)).toEqual({ started_at: null, ended_at: null });
    await migration.up(runner);
  });
});
