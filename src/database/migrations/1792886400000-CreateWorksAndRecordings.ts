import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/** The columns every credit shares, scoped to one kind of contribution role. */
const creditColumns = (table: string, scope: string) => `
  catalog_identity_id integer NOT NULL,
  contribution_role_id integer NOT NULL,
  role_scope contribution_role_scope NOT NULL DEFAULT '${scope}',
  credited_as varchar(200),
  position smallint NOT NULL DEFAULT 0,
  details text,
  source_text text,
  source_url text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ${table}_catalog_identity_id_fkey
    FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
  -- A role is only creditable in the scopes it allows.
  CONSTRAINT ${table}_role_fkey
    FOREIGN KEY (contribution_role_id, role_scope) REFERENCES contribution_role_scopes (contribution_role_id, scope) ON DELETE RESTRICT,
  CONSTRAINT ${table}_role_scope CHECK (role_scope = '${scope}'),
  CONSTRAINT ${table}_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> ''),
  CONSTRAINT ${table}_position_nonnegative CHECK (position >= 0),
  CONSTRAINT ${table}_source_url_format CHECK (source_url IS NULL OR source_url ~* '^https?://[^\\s]+$')
`;

/**
 * The work and recording editorial roots (docs/music-catalog-model.md §2 and
 * §4) and the rows they own: the credits of each, the genres of a recording
 * and the works a recording performs, interpolates or samples. Only applied
 * microchanges write them.
 */
export class CreateWorksAndRecordings1792886400000 implements MigrationInterface {
  name = 'CreateWorksAndRecordings1792886400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The id is the public identifier of a work; the slug is kept when the title changes.
    await queryRunner.query(`
      CREATE TABLE works (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title varchar(300) NOT NULL,
        slug varchar(320) NOT NULL,
        description text,
        iswc char(11),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT works_slug_key UNIQUE (slug),
        CONSTRAINT works_iswc_key UNIQUE (iswc),
        CONSTRAINT works_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT works_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT works_title_nonblank CHECK (btrim(title) <> ''),
        CONSTRAINT works_slug_format CHECK (slug ~ '^[^\\s/?#A-Z]+$'),
        CONSTRAINT works_iswc_format CHECK (iswc ~ '^T[0-9]{10}$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE work_contributions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        work_id bigint NOT NULL,
        ${creditColumns('work_contributions', 'work')},
        CONSTRAINT work_contributions_work_id_fkey FOREIGN KEY (work_id) REFERENCES works (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX work_contributions_work_id_idx ON work_contributions (work_id)`);
    await queryRunner.query(`CREATE INDEX work_contributions_catalog_identity_id_idx ON work_contributions (catalog_identity_id)`);
    await queryRunner.query(`CREATE INDEX work_contributions_role_idx ON work_contributions (contribution_role_id, role_scope)`);

    await queryRunner.query(`
      CREATE TABLE recordings (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        title varchar(300) NOT NULL,
        "desc" text,
        is_explicit boolean NOT NULL DEFAULT false,
        isrc char(12),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        recording_year smallint,
        recording_month smallint,
        recording_day smallint,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT recordings_uuid_key UNIQUE (uuid),
        CONSTRAINT recordings_public_id_key UNIQUE (public_id),
        CONSTRAINT recordings_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT recordings_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT recordings_title_nonblank CHECK (btrim(title) <> ''),
        CONSTRAINT recordings_isrc_format CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
        CONSTRAINT recordings_recording_date CHECK (${partialDateCheck('recording')})
      )
    `);

    await queryRunner.query(`
      CREATE TABLE recording_contributions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        recording_id integer NOT NULL,
        ${creditColumns('recording_contributions', 'recording')},
        CONSTRAINT recording_contributions_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX recording_contributions_recording_id_idx ON recording_contributions (recording_id)`);
    await queryRunner.query(`CREATE INDEX recording_contributions_catalog_identity_id_idx ON recording_contributions (catalog_identity_id)`);
    await queryRunner.query(`CREATE INDEX recording_contributions_role_idx ON recording_contributions (contribution_role_id, role_scope)`);

    await queryRunner.query(`CREATE TYPE recording_work_relation_type AS ENUM ('performance', 'interpolation', 'sample')`);
    await queryRunner.query(`
      CREATE TABLE recording_works (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        recording_id integer NOT NULL,
        work_id bigint NOT NULL,
        relation_type recording_work_relation_type NOT NULL DEFAULT 'performance',
        position smallint,
        details text,
        source_text text,
        source_url text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT recording_works_recording_id_work_id_relation_type_key UNIQUE (recording_id, work_id, relation_type),
        CONSTRAINT recording_works_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT,
        CONSTRAINT recording_works_work_id_fkey FOREIGN KEY (work_id) REFERENCES works (id) ON DELETE RESTRICT,
        -- The order of the works of a medley.
        CONSTRAINT recording_works_position_positive CHECK (position IS NULL OR position > 0),
        CONSTRAINT recording_works_source_url_format CHECK (source_url IS NULL OR source_url ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX recording_works_work_id_idx ON recording_works (work_id)`);

    await queryRunner.query(`
      CREATE TABLE recording_genres (
        recording_id integer NOT NULL,
        genre_id integer NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT recording_genres_pkey PRIMARY KEY (recording_id, genre_id),
        CONSTRAINT recording_genres_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES recordings (id) ON DELETE RESTRICT,
        CONSTRAINT recording_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES genres (id) ON DELETE RESTRICT
      )
    `);
    // At most one primary genre per recording.
    await queryRunner.query(`CREATE UNIQUE INDEX recording_genres_primary_key ON recording_genres (recording_id) WHERE is_primary`);
    await queryRunner.query(`CREATE INDEX recording_genres_genre_id_idx ON recording_genres (genre_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE recording_genres');
    await queryRunner.query('DROP TABLE recording_works');
    await queryRunner.query('DROP TYPE recording_work_relation_type');
    await queryRunner.query('DROP TABLE recording_contributions');
    await queryRunner.query('DROP TABLE recordings');
    await queryRunner.query('DROP TABLE work_contributions');
    await queryRunner.query('DROP TABLE works');
  }
}
