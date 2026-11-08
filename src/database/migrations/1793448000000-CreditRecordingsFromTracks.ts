import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the existing track credits to their recordings (ADR 0008). Each
 * recording takes the credit of its track in the earliest published, not
 * cancelled release: undated releases go last, and a tie goes to the lowest
 * release id, then disc and track number. Then each track whose whole credit
 * (artists, rank, position and credited name) equals its recording's loses
 * it, since it no longer differs from what the track shows. A recording only
 * in unpublished releases gets nothing, and its tracks keep their credits.
 * These rows are written outside the editorial flow, so no revision records
 * them.
 *
 * Going down copies each recording's credit back to its tracks without a
 * printed credit and empties the recording credits, as they were before.
 */
export class CreditRecordingsFromTracks1793448000000 implements MigrationInterface {
  name = 'CreditRecordingsFromTracks1793448000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO recording_artist_credits (artist_id, recording_id, rank, position, credited_as, created_at, updated_at)
      SELECT credit.artist_id, earliest.recording_id, credit.rank, credit.position, credit.credited_as, credit.created_at, credit.updated_at
      FROM (
        SELECT DISTINCT ON (track.recording_id) track.recording_id, track.id AS track_id
        FROM tracks track
        JOIN releases release ON release.id = track.release_id
        JOIN editorial_entities root ON root.id = release.editorial_entity_id
        WHERE root.publication_status = 'published' AND NOT release.is_cancelled
        ORDER BY track.recording_id, release.release_year ASC NULLS LAST, release.release_month ASC NULLS FIRST,
          release.release_day ASC NULLS FIRST, release.id, track.disc_number, track.track_number
      ) earliest
      JOIN track_artist_credits credit ON credit.track_id = earliest.track_id
    `);
    await queryRunner.query(`
      DELETE FROM track_artist_credits printed
      USING tracks track
      WHERE track.id = printed.track_id
        AND EXISTS (SELECT 1 FROM recording_artist_credits own WHERE own.recording_id = track.recording_id)
        AND NOT EXISTS (
          (SELECT artist_id, rank, position, credited_as FROM track_artist_credits WHERE track_id = track.id
           EXCEPT SELECT artist_id, rank, position, credited_as FROM recording_artist_credits WHERE recording_id = track.recording_id)
          UNION ALL
          (SELECT artist_id, rank, position, credited_as FROM recording_artist_credits WHERE recording_id = track.recording_id
           EXCEPT SELECT artist_id, rank, position, credited_as FROM track_artist_credits WHERE track_id = track.id)
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO track_artist_credits (artist_id, track_id, rank, position, credited_as, created_at, updated_at)
      SELECT own.artist_id, track.id, own.rank, own.position, own.credited_as, own.created_at, own.updated_at
      FROM tracks track
      JOIN recording_artist_credits own ON own.recording_id = track.recording_id
      WHERE NOT EXISTS (SELECT 1 FROM track_artist_credits printed WHERE printed.track_id = track.id)
    `);
    await queryRunner.query('DELETE FROM recording_artist_credits');
  }
}
