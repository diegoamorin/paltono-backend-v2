import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { currentTestDatabaseUrl } from '../support/console';

/*
 * The API validates partial dates before they reach the database, so it
 * cannot show that the schema refuses them too. This goes to the database
 * inside a transaction, whose rollback leaves the shared test database as it
 * was.
 */
describe('partial dates in the schema', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let userId: number;

  beforeAll(async () => {
    dataSource = await new DataSource(databaseOptions(currentTestDatabaseUrl())).initialize();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    [{ id: userId }] = await runner.query(
      `INSERT INTO users (uuid, username, email, display_name, created_at, updated_at, username_changed_at)
       VALUES ($1, 'autora', 'autora@example.com', 'Autora', now(), now(), now()) RETURNING id`,
      [randomUUID()],
    );
  });

  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function insertIdentity(type: 'person' | 'organization'): Promise<number> {
    const entityId = randomUUID();
    await runner.query(`INSERT INTO editorial_entities (id, entity_type, created_by, created_at) VALUES ($1, 'identity', $2, now())`, [entityId, userId]);
    const [{ id }] = await runner.query(
      `INSERT INTO catalog_identities (uuid, public_id, display_name, type, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Identidad', $3, now(), now(), $4) RETURNING id`,
      [randomUUID(), entityId.replaceAll('-', '').slice(0, 21), type, entityId],
    );
    return id;
  }

  /** Runs a statement the schema must refuse, and leaves the transaction usable. */
  async function expectRefused(statement: string, constraint: string): Promise<void> {
    await runner.query('SAVEPOINT refused');
    await expect(runner.query(statement)).rejects.toThrow(constraint);
    await runner.query('ROLLBACK TO SAVEPOINT refused');
  }

  describe('the birth and the death of a person', () => {
    let personId: number;
    const update = (columns: string) => `UPDATE people SET ${columns} WHERE catalog_identity_id = ${personId}`;

    beforeEach(async () => {
      personId = await insertIdentity('person');
      await runner.query(`INSERT INTO people (catalog_identity_id) VALUES ($1)`, [personId]);
    });

    it('accepts a birthday without a year, February 29 too', async () => {
      await runner.query(update('birth_month = 2, birth_day = 29'));

      expect((await runner.query(`SELECT birth_year, birth_month, birth_day FROM people WHERE catalog_identity_id = $1`, [personId]))[0]).toEqual({
        birth_year: null,
        birth_month: 2,
        birth_day: 29,
      });
    });

    it('refuses a birth month alone and a birthday that does not exist', async () => {
      await expectRefused(update('birth_month = 3'), 'people_birth_date');
      await expectRefused(update('birth_month = 2, birth_day = 30'), 'people_birth_date');
    });

    it('refuses a date that cannot exist', async () => {
      await expectRefused(update('birth_year = 1993, birth_month = 2, birth_day = 29'), 'people_birth_date');
      await expectRefused(update('death_year = 2021, death_month = 4, death_day = 31'), 'people_death_date');
    });

    it('refuses a death month without its year', async () => {
      await expectRefused(update('death_month = 3'), 'people_death_date');
    });

    it('leaves the order of birth and death to the code', async () => {
      await runner.query(update('birth_year = 2000, birth_month = 4, death_year = 2000, death_month = 3'));
    });
  });

  describe('the start and the end of an affiliation', () => {
    let artistId: number;
    let organizationId: number;

    beforeEach(async () => {
      const artistIdentity = await insertIdentity('person');
      organizationId = await insertIdentity('organization');
      await runner.query(`INSERT INTO organizations (catalog_identity_id) VALUES ($1)`, [organizationId]);
      [{ id: artistId }] = await runner.query(
        `INSERT INTO artists (uuid, public_id, catalog_identity_id, created_at, updated_at) VALUES ($1, 'artista', $2, now(), now()) RETURNING id`,
        [randomUUID(), artistIdentity],
      );
    });

    /** A former affiliation with no dates, and returns its id. */
    async function insertAffiliation(relationshipType = 'agency'): Promise<number> {
      const [{ id }] = await runner.query(
        `INSERT INTO artist_organization_affiliations (artist_id, organization_id, relationship_type, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'former', now(), now()) RETURNING id`,
        [artistId, organizationId, relationshipType],
      );
      return id;
    }

    it('refuses a date that cannot exist and a month without its year', async () => {
      const id = await insertAffiliation();
      const update = (columns: string) => `UPDATE artist_organization_affiliations SET ${columns} WHERE id = ${id}`;

      await expectRefused(update('started_year = 2023, started_month = 2, started_day = 29'), 'artist_organization_affiliations_started_date');
      await expectRefused(update('ended_month = 2'), 'artist_organization_affiliations_ended_date');
    });

    it('leaves the order of start and end to the code', async () => {
      const id = await insertAffiliation();

      await runner.query(`UPDATE artist_organization_affiliations SET started_year = 2020, started_month = 4, ended_year = 2020, ended_month = 3 WHERE id = ${id}`);
    });

    it('keeps the status coherent with a known end, by its year', async () => {
      const id = await insertAffiliation();

      await runner.query(`UPDATE artist_organization_affiliations SET ended_year = 2020 WHERE id = ${id}`);
      await expectRefused(`UPDATE artist_organization_affiliations SET status = 'current' WHERE id = ${id}`, 'artist_organization_affiliations_status');
      await expectRefused(`UPDATE artist_organization_affiliations SET status = 'unknown' WHERE id = ${id}`, 'artist_organization_affiliations_status');
    });

    it('keeps two affiliations from sharing organization, type and start, also an unknown one', async () => {
      const first = await insertAffiliation('agency');
      const second = await insertAffiliation('label');
      const relabel = (id: number, start: string) => `UPDATE artist_organization_affiliations SET relationship_type = 'label', ${start} WHERE id = ${id}`;

      await expectRefused(relabel(first, 'started_year = NULL'), 'artist_organization_affiliations_period_key');

      await runner.query(`UPDATE artist_organization_affiliations SET started_year = 2020 WHERE id IN (${first}, ${second})`);
      await expectRefused(relabel(first, 'started_year = 2020'), 'artist_organization_affiliations_period_key');
      await runner.query(relabel(first, 'started_year = 2020, started_month = 3'));
    });
  });
});
