import { MigrationInterface, QueryRunner } from 'typeorm';

const deathDateCheck = `(death_year IS NULL OR death_year BETWEEN 1 AND 9999) AND (death_month IS NULL OR (death_year IS NOT NULL AND death_month BETWEEN 1 AND 12)) AND (death_day IS NULL OR (death_month IS NOT NULL AND death_day BETWEEN 1 AND extract(day FROM make_date(death_year, death_month, 1) + interval '1 month - 1 day')))`;

const birthDateCheck = `(birth_year IS NULL OR birth_year BETWEEN 1 AND 9999) AND (birth_month IS NULL OR birth_month BETWEEN 1 AND 12) AND (birth_day IS NULL OR (birth_month IS NOT NULL AND birth_day BETWEEN 1 AND extract(day FROM make_date(coalesce(birth_year, 2000), birth_month, 1) + interval '1 month - 1 day'))) AND (birth_year IS NOT NULL OR birth_month IS NULL OR birth_day IS NOT NULL)`;

/**
 * The birth and the death of a person become partial dates, and the birth may
 * be a birthday without a year. Existing dates are copied. A partial date
 * cannot be compared in a column check, so the lifespan rule moves to the
 * code, like the founding and the dissolution.
 *
 * Going down keeps only complete dates: a partial one does not fit a `date`
 * column and becomes NULL.
 */
export class PartialPersonDates1793275200000 implements MigrationInterface {
  name = 'PartialPersonDates1793275200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE people
        ADD COLUMN birth_year smallint,
        ADD COLUMN birth_month smallint,
        ADD COLUMN birth_day smallint,
        ADD COLUMN death_year smallint,
        ADD COLUMN death_month smallint,
        ADD COLUMN death_day smallint
    `);
    await queryRunner.query(`
      UPDATE people SET
        birth_year = extract(year FROM birth_date),
        birth_month = extract(month FROM birth_date),
        birth_day = extract(day FROM birth_date),
        death_year = extract(year FROM death_date),
        death_month = extract(month FROM death_date),
        death_day = extract(day FROM death_date)
    `);
    await queryRunner.query(`
      ALTER TABLE people
        DROP CONSTRAINT people_lifespan,
        DROP COLUMN birth_date,
        DROP COLUMN death_date,
        ADD CONSTRAINT people_birth_date CHECK (${birthDateCheck}),
        ADD CONSTRAINT people_death_date CHECK (${deathDateCheck})
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE people
        DROP CONSTRAINT people_birth_date,
        DROP CONSTRAINT people_death_date,
        ADD COLUMN birth_date date,
        ADD COLUMN death_date date
    `);
    await queryRunner.query(`
      UPDATE people SET
        birth_date = make_date(birth_year, birth_month, birth_day),
        death_date = make_date(death_year, death_month, death_day)
    `);
    await queryRunner.query(`
      ALTER TABLE people
        DROP COLUMN birth_year,
        DROP COLUMN birth_month,
        DROP COLUMN birth_day,
        DROP COLUMN death_year,
        DROP COLUMN death_month,
        DROP COLUMN death_day,
        ADD CONSTRAINT people_lifespan CHECK (death_date >= birth_date)
    `);
  }
}
