import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the platform links from tracks to recordings, at most one per
 * platform (ADR 0009). Production had no track links, so none is carried
 * over; the platforms that supported tracks now support recordings.
 */
export class MovePlatformLinksToRecordings1793534400000 implements MigrationInterface {
  name = 'MovePlatformLinksToRecordings1793534400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE track_platform_links');
    await queryRunner.query('ALTER TABLE platforms RENAME COLUMN supports_track TO supports_recording');
    await queryRunner.query(`
      CREATE TABLE recording_platform_links (
        recording_id integer NOT NULL,
        platform_id integer NOT NULL,
        url varchar(2048) NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT recording_platform_links_pkey PRIMARY KEY (recording_id, platform_id),
        CONSTRAINT recording_platform_links_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT,
        CONSTRAINT recording_platform_links_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE RESTRICT,
        CONSTRAINT recording_platform_links_url_format CHECK (url ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX recording_platform_links_platform_id_idx ON recording_platform_links (platform_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE recording_platform_links');
    await queryRunner.query('ALTER TABLE platforms RENAME COLUMN supports_recording TO supports_track');
    await queryRunner.query(`
      CREATE TABLE track_platform_links (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        platform_id integer NOT NULL,
        track_id integer NOT NULL,
        url varchar(2048) NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT track_platform_links_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE RESTRICT,
        CONSTRAINT track_platform_links_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE RESTRICT,
        CONSTRAINT track_platform_links_track_platform_url_key UNIQUE (track_id, platform_id, url),
        CONSTRAINT track_platform_links_url_format CHECK (url ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX track_platform_links_platform_id_idx ON track_platform_links (platform_id)`);
  }
}
