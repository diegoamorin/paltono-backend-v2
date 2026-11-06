import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/**
 * The start and the end of an affiliation become partial dates. Existing dates
 * are copied. A partial date cannot be compared in a column check, so the
 * interval rule moves to the code, like the founding and the dissolution.
 *
 * Going down keeps only complete dates: a partial one does not fit a `date`
 * column and becomes NULL. Two affiliations told apart only by partial starts
 * then collide, and the migration fails rather than choose one to delete.
 */
export class PartialAffiliationDates1793361600000 implements MigrationInterface {
  name = 'PartialAffiliationDates1793361600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE artist_organization_affiliations
        ADD COLUMN started_year smallint,
        ADD COLUMN started_month smallint,
        ADD COLUMN started_day smallint,
        ADD COLUMN ended_year smallint,
        ADD COLUMN ended_month smallint,
        ADD COLUMN ended_day smallint
    `);
    await queryRunner.query(`
      UPDATE artist_organization_affiliations SET
        started_year = extract(year FROM started_at),
        started_month = extract(month FROM started_at),
        started_day = extract(day FROM started_at),
        ended_year = extract(year FROM ended_at),
        ended_month = extract(month FROM ended_at),
        ended_day = extract(day FROM ended_at)
    `);
    await queryRunner.query(`
      ALTER TABLE artist_organization_affiliations
        DROP CONSTRAINT artist_organization_affiliations_period_key,
        DROP CONSTRAINT artist_organization_affiliations_interval,
        DROP CONSTRAINT artist_organization_affiliations_status,
        DROP COLUMN started_at,
        DROP COLUMN ended_at,
        ADD CONSTRAINT artist_organization_affiliations_period_key
          UNIQUE NULLS NOT DISTINCT (artist_id, organization_id, relationship_type, started_year, started_month, started_day),
        ADD CONSTRAINT artist_organization_affiliations_started_date CHECK (${partialDateCheck('started')}),
        ADD CONSTRAINT artist_organization_affiliations_ended_date CHECK (${partialDateCheck('ended')}),
        ADD CONSTRAINT artist_organization_affiliations_status CHECK (
          (ended_year IS NULL OR status = 'former') AND (status <> 'current' OR ended_year IS NULL)
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE artist_organization_affiliations
        DROP CONSTRAINT artist_organization_affiliations_period_key,
        DROP CONSTRAINT artist_organization_affiliations_started_date,
        DROP CONSTRAINT artist_organization_affiliations_ended_date,
        DROP CONSTRAINT artist_organization_affiliations_status,
        ADD COLUMN started_at date,
        ADD COLUMN ended_at date
    `);
    await queryRunner.query(`
      UPDATE artist_organization_affiliations SET
        started_at = make_date(started_year, started_month, started_day),
        ended_at = make_date(ended_year, ended_month, ended_day)
    `);
    await queryRunner.query(`
      ALTER TABLE artist_organization_affiliations
        DROP COLUMN started_year,
        DROP COLUMN started_month,
        DROP COLUMN started_day,
        DROP COLUMN ended_year,
        DROP COLUMN ended_month,
        DROP COLUMN ended_day,
        ADD CONSTRAINT artist_organization_affiliations_period_key
          UNIQUE NULLS NOT DISTINCT (artist_id, organization_id, relationship_type, started_at),
        ADD CONSTRAINT artist_organization_affiliations_interval CHECK (ended_at >= started_at),
        ADD CONSTRAINT artist_organization_affiliations_status CHECK (
          (ended_at IS NULL OR status = 'former') AND (status <> 'current' OR ended_at IS NULL)
        )
    `);
  }
}
