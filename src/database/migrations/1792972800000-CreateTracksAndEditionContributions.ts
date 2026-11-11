import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The rows an edition owns besides its fields (docs/music-catalog-model.md §3
 * and §4): its tracks, the printed credit of each track, and the credits of
 * the edition itself. Only applied microchanges write them.
 */
export class CreateTracksAndEditionContributions1792972800000 implements MigrationInterface {
  name = 'CreateTracksAndEditionContributions1792972800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A recording may appear in several editions and positions; a position holds one track.
    await queryRunner.query(`
      CREATE TABLE tracks (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        edition_id integer NOT NULL,
        recording_id integer NOT NULL,
        disc_number smallint NOT NULL,
        track_number smallint NOT NULL,
        title varchar(512),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT tracks_edition_id_disc_number_track_number_key UNIQUE (edition_id, disc_number, track_number),
        CONSTRAINT tracks_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES editions (id) ON DELETE RESTRICT,
        CONSTRAINT tracks_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT,
        CONSTRAINT tracks_position_positive CHECK (disc_number > 0 AND track_number > 0),
        -- NULL shows the recording's current title, never a copy of it.
        CONSTRAINT tracks_title_nonblank CHECK (title IS NULL OR btrim(title) <> '')
      )
    `);
    await queryRunner.query(`CREATE INDEX tracks_recording_id_idx ON tracks (recording_id)`);

    // A printed credit, where the track shows other artists than its recording (ADR 0008).
    await queryRunner.query(`
      CREATE TABLE track_artist_credits (
        artist_id integer NOT NULL,
        track_id integer NOT NULL,
        rank track_artist_rank NOT NULL,
        position smallint NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        credited_as varchar(200),
        CONSTRAINT track_artist_credits_pkey PRIMARY KEY (artist_id, track_id),
        CONSTRAINT track_artist_credits_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT,
        CONSTRAINT track_artist_credits_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE RESTRICT,
        CONSTRAINT track_artist_credits_position_nonnegative CHECK (position >= 0),
        CONSTRAINT track_artist_credits_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> '')
      )
    `);
    await queryRunner.query(`CREATE INDEX track_artist_credits_track_id_idx ON track_artist_credits (track_id)`);

    await queryRunner.query(`
      CREATE TABLE edition_contributions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        edition_id integer NOT NULL,
        catalog_identity_id integer NOT NULL,
        contribution_role_id integer NOT NULL,
        role_scope contribution_role_scope NOT NULL DEFAULT 'edition',
        credited_as varchar(200),
        position smallint NOT NULL DEFAULT 0,
        details text,
        source_text text,
        source_url text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT edition_contributions_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES editions (id) ON DELETE RESTRICT,
        CONSTRAINT edition_contributions_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        -- A role is only creditable in the scopes it allows.
        CONSTRAINT edition_contributions_role_fkey
          FOREIGN KEY (contribution_role_id, role_scope) REFERENCES contribution_role_scopes (contribution_role_id, scope) ON DELETE RESTRICT,
        CONSTRAINT edition_contributions_role_scope CHECK (role_scope = 'edition'),
        CONSTRAINT edition_contributions_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> ''),
        CONSTRAINT edition_contributions_position_nonnegative CHECK (position >= 0),
        CONSTRAINT edition_contributions_source_url_format CHECK (source_url IS NULL OR source_url ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX edition_contributions_edition_id_idx ON edition_contributions (edition_id)`);
    await queryRunner.query(`CREATE INDEX edition_contributions_catalog_identity_id_idx ON edition_contributions (catalog_identity_id)`);
    await queryRunner.query(`CREATE INDEX edition_contributions_role_idx ON edition_contributions (contribution_role_id, role_scope)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE edition_contributions');
    await queryRunner.query('DROP TABLE track_artist_credits');
    await queryRunner.query('DROP TABLE tracks');
  }
}
