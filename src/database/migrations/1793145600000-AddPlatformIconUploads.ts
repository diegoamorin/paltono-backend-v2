import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform icons are SVG uploads of their own purpose, and each one is the
 * icon of a single platform (ADR 0005). Production had no platforms when this
 * ran, so no external icon URL needed replacing.
 */
export class AddPlatformIconUploads1793145600000 implements MigrationInterface {
  name = 'AddPlatformIconUploads1793145600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE image_upload_purpose ADD VALUE 'platform_icon'`);
    await queryRunner.query('ALTER TABLE platforms ADD CONSTRAINT platforms_icon_url_key UNIQUE (icon_url)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE platforms DROP CONSTRAINT platforms_icon_url_key');
    // Postgres cannot drop an enum value: the type is rebuilt without it, which fails while a platform icon upload exists.
    await queryRunner.query('ALTER TYPE image_upload_purpose RENAME TO image_upload_purpose_old');
    await queryRunner.query(`CREATE TYPE image_upload_purpose AS ENUM ('catalog', 'avatar')`);
    await queryRunner.query(
      'ALTER TABLE image_uploads ALTER COLUMN purpose TYPE image_upload_purpose USING purpose::text::image_upload_purpose',
    );
    await queryRunner.query('DROP TYPE image_upload_purpose_old');
  }
}
