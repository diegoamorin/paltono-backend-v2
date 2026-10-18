import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/**
 * The release group and release editorial roots (docs/music-catalog-model.md
 * §3) and the presentation credits a release group owns. Only applied
 * microchanges write them.
 */
export class CreateReleaseGroupsAndReleases1792929600000 implements MigrationInterface {
  name = 'CreateReleaseGroupsAndReleases1792929600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE release_group_type AS ENUM ('album', 'ep', 'single', 'compilation')`);
    await queryRunner.query(`
      CREATE TABLE release_groups (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        title varchar(512) NOT NULL,
        type release_group_type NOT NULL,
        description text,
        repackage_of_id integer,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT release_groups_uuid_key UNIQUE (uuid),
        CONSTRAINT release_groups_public_id_key UNIQUE (public_id),
        CONSTRAINT release_groups_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT release_groups_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT release_groups_repackage_of_id_fkey
          FOREIGN KEY (repackage_of_id) REFERENCES release_groups (id) ON DELETE RESTRICT,
        CONSTRAINT release_groups_title_nonblank CHECK (btrim(title) <> ''),
        -- Longer cycles are refused under lock when a repackage link is applied.
        CONSTRAINT release_groups_repackage_not_self CHECK (repackage_of_id <> id)
      )
    `);
    await queryRunner.query(`CREATE INDEX release_groups_repackage_of_id_idx ON release_groups (repackage_of_id)`);

    await queryRunner.query(`
      CREATE TABLE release_artist_credits (
        artist_id integer NOT NULL,
        release_group_id integer NOT NULL,
        position integer NOT NULL,
        credited_as varchar(200),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT release_artist_credits_pkey PRIMARY KEY (artist_id, release_group_id),
        CONSTRAINT release_artist_credits_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT,
        CONSTRAINT release_artist_credits_release_group_id_fkey
          FOREIGN KEY (release_group_id) REFERENCES release_groups (id) ON DELETE RESTRICT,
        CONSTRAINT release_artist_credits_position_nonnegative CHECK (position >= 0),
        CONSTRAINT release_artist_credits_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> '')
      )
    `);
    await queryRunner.query(`CREATE INDEX release_artist_credits_release_group_id_idx ON release_artist_credits (release_group_id)`);

    await queryRunner.query(`
      CREATE TABLE releases (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        release_group_id integer NOT NULL,
        title varchar(512),
        edition_name varchar(200),
        release_year smallint,
        release_month smallint,
        release_day smallint,
        release_time time,
        timezone varchar(64),
        cover_art_url varchar(2048),
        is_cancelled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT releases_uuid_key UNIQUE (uuid),
        CONSTRAINT releases_public_id_key UNIQUE (public_id),
        CONSTRAINT releases_editorial_entity_id_key UNIQUE (editorial_entity_id),
        -- At most one unnamed, standard edition per release group.
        CONSTRAINT releases_release_group_id_edition_name_key UNIQUE NULLS NOT DISTINCT (release_group_id, edition_name),
        CONSTRAINT releases_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT releases_release_group_id_fkey FOREIGN KEY (release_group_id) REFERENCES release_groups (id) ON DELETE RESTRICT,
        CONSTRAINT releases_title_nonblank CHECK (title IS NULL OR btrim(title) <> ''),
        CONSTRAINT releases_edition_name_nonblank CHECK (edition_name IS NULL OR btrim(edition_name) <> ''),
        CONSTRAINT releases_release_date CHECK (${partialDateCheck('release')}),
        -- The time and its IANA zone go together, and only with a complete date.
        CONSTRAINT releases_release_time CHECK (
          (release_time IS NULL AND timezone IS NULL) OR (release_time IS NOT NULL AND timezone IS NOT NULL AND release_day IS NOT NULL)
        ),
        CONSTRAINT releases_cover_art_url_format CHECK (cover_art_url IS NULL OR cover_art_url ~* '^https?://[^\\s]+$')
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE releases');
    await queryRunner.query('DROP TABLE release_artist_credits');
    await queryRunner.query('DROP TABLE release_groups');
    await queryRunner.query('DROP TYPE release_group_type');
  }
}
