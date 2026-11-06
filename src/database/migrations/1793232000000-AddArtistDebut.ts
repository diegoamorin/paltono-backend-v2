import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/**
 * The debut of an artist, a partial date like the founding of an organization.
 * It is an editorial datum backed by sources, so existing profiles start
 * without one.
 */
export class AddArtistDebut1793232000000 implements MigrationInterface {
  name = 'AddArtistDebut1793232000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE artists
        ADD COLUMN debut_year smallint,
        ADD COLUMN debut_month smallint,
        ADD COLUMN debut_day smallint,
        ADD CONSTRAINT artists_debut_date CHECK (${partialDateCheck('debut')})
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE artists
        DROP CONSTRAINT artists_debut_date,
        DROP COLUMN debut_day,
        DROP COLUMN debut_month,
        DROP COLUMN debut_year
    `);
  }
}
