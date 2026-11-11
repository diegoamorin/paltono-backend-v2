import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image uploads (ADR 0005): every image an account handed to the platform, for
 * the catalog, as its avatar or as a platform's SVG icon. They count the
 * upload quota, tell who uploaded each image, keep its dimensions and the
 * moment its file was removed from storage, and survive the account's
 * deletion, like the rest of its history.
 */
export class CreateImageUploads1793059200000 implements MigrationInterface {
  name = 'CreateImageUploads1793059200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE image_upload_purpose AS ENUM ('catalog', 'avatar', 'platform_icon')`);
    await queryRunner.query(`
      CREATE TABLE image_uploads (
        id uuid PRIMARY KEY,
        uploaded_by integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
        purpose image_upload_purpose NOT NULL,
        url varchar(2048) NOT NULL,
        bytes integer NOT NULL,
        width integer NOT NULL,
        height integer NOT NULL,
        created_at timestamptz NOT NULL,
        file_removed_at timestamptz,
        CONSTRAINT image_uploads_url_key UNIQUE (url),
        CONSTRAINT image_uploads_url_format CHECK (url ~ '^https?://'),
        CONSTRAINT image_uploads_bytes_positive CHECK (bytes > 0),
        CONSTRAINT image_uploads_dimensions_positive CHECK (width > 0 AND height > 0)
      )
    `);
    // The upload quota counts an account's uploads of one purpose in a recent window.
    await queryRunner.query(
      `CREATE INDEX image_uploads_uploaded_by_purpose_created_at_idx ON image_uploads (uploaded_by, purpose, created_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE image_uploads');
    await queryRunner.query('DROP TYPE image_upload_purpose');
  }
}
