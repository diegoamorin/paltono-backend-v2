import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image uploads keep the dimensions of the stored image, and the moment their
 * file was removed from storage (ADR 0005). The table was empty in production
 * when this ran; a development database is rebuilt with `pnpm db:rebuild`.
 */
export class AddImageUploadDimensionsAndFileRemoval1793102400000 implements MigrationInterface {
  name = 'AddImageUploadDimensionsAndFileRemoval1793102400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE image_uploads
        ADD COLUMN width integer NOT NULL,
        ADD COLUMN height integer NOT NULL,
        ADD COLUMN file_removed_at timestamptz,
        ADD CONSTRAINT image_uploads_dimensions_positive CHECK (width > 0 AND height > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE image_uploads
        DROP CONSTRAINT image_uploads_dimensions_positive,
        DROP COLUMN file_removed_at,
        DROP COLUMN height,
        DROP COLUMN width
    `);
  }
}
