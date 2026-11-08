import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The artist credit of a recording (ADR 0008): the same shape as a track's,
 * whose rows now mean a printed credit. A recording may have none.
 */
export class CreateRecordingArtistCredits1793404800000 implements MigrationInterface {
  name = 'CreateRecordingArtistCredits1793404800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE recording_artist_credits (
        artist_id integer NOT NULL,
        recording_id integer NOT NULL,
        rank track_artist_rank NOT NULL,
        position smallint NOT NULL,
        credited_as varchar(200),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT recording_artist_credits_pkey PRIMARY KEY (artist_id, recording_id),
        CONSTRAINT recording_artist_credits_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT,
        CONSTRAINT recording_artist_credits_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT,
        CONSTRAINT recording_artist_credits_position_nonnegative CHECK (position >= 0),
        CONSTRAINT recording_artist_credits_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> '')
      )
    `);
    await queryRunner.query(`CREATE INDEX recording_artist_credits_recording_id_idx ON recording_artist_credits (recording_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE recording_artist_credits');
  }
}
