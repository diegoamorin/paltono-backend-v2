import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

const URL_CHECK = (column: string) => `${column} ~* '^https?://[^\\s]+$'`;

/**
 * The tour and event editorial roots and the artists, organizers and links
 * each one owns (ERDiagram.mdj). Only applied microchanges write them; the
 * countries and dates of a tour are derived from its published events.
 */
export class CreateToursAndEvents1792972800000 implements MigrationInterface {
  name = 'CreateToursAndEvents1792972800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE tour_status AS ENUM ('announced', 'scheduled', 'in_progress', 'postponed', 'cancelled', 'completed')`);
    await queryRunner.query(`CREATE TYPE event_status AS ENUM ('announced', 'scheduled', 'postponed', 'cancelled', 'performed')`);
    await queryRunner.query(`CREATE TYPE event_type AS ENUM ('concert')`);
    await queryRunner.query(`CREATE TYPE live_artist_role AS ENUM ('main', 'support', 'guest')`);
    await queryRunner.query(`CREATE TYPE live_link_purpose AS ENUM ('official', 'tickets')`);

    await queryRunner.query(`
      CREATE TABLE tours (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        title varchar(512) NOT NULL,
        description text,
        image_url text,
        start_year smallint,
        start_month smallint,
        start_day smallint,
        end_year smallint,
        end_month smallint,
        end_day smallint,
        status tour_status NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT tours_uuid_key UNIQUE (uuid),
        CONSTRAINT tours_public_id_key UNIQUE (public_id),
        CONSTRAINT tours_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT tours_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT tours_title_nonblank CHECK (btrim(title) <> ''),
        CONSTRAINT tours_image_url_format CHECK (image_url IS NULL OR ${URL_CHECK('image_url')}),
        CONSTRAINT tours_start_date CHECK (${partialDateCheck('start')}),
        CONSTRAINT tours_end_date CHECK (${partialDateCheck('end')}),
        -- A scheduled tour has at least a known start year.
        CONSTRAINT tours_scheduled_start CHECK (status <> 'scheduled' OR start_year IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE events (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        title varchar(512) NOT NULL,
        type event_type NOT NULL DEFAULT 'concert',
        description text,
        image_url text,
        tour_id integer,
        start_year smallint,
        start_month smallint,
        start_day smallint,
        start_time time,
        timezone varchar(64),
        country_id integer,
        city varchar(200),
        venue_name varchar(300),
        status event_status NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT events_uuid_key UNIQUE (uuid),
        CONSTRAINT events_public_id_key UNIQUE (public_id),
        CONSTRAINT events_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT events_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT events_tour_id_fkey FOREIGN KEY (tour_id) REFERENCES tours (id) ON DELETE RESTRICT,
        CONSTRAINT events_country_id_fkey FOREIGN KEY (country_id) REFERENCES countries (id) ON DELETE RESTRICT,
        CONSTRAINT events_title_nonblank CHECK (btrim(title) <> ''),
        CONSTRAINT events_city_nonblank CHECK (city IS NULL OR btrim(city) <> ''),
        CONSTRAINT events_venue_name_nonblank CHECK (venue_name IS NULL OR btrim(venue_name) <> ''),
        CONSTRAINT events_image_url_format CHECK (image_url IS NULL OR ${URL_CHECK('image_url')}),
        CONSTRAINT events_start_date CHECK (${partialDateCheck('start')}),
        -- A time needs a complete date and its IANA zone; a zone may stand without a time.
        CONSTRAINT events_start_time CHECK (start_time IS NULL OR (start_day IS NOT NULL AND timezone IS NOT NULL)),
        -- A scheduled event has a complete date; a postponed one has none until it is rescheduled.
        CONSTRAINT events_scheduled_date CHECK (status <> 'scheduled' OR start_day IS NOT NULL),
        CONSTRAINT events_postponed_date CHECK (status <> 'postponed' OR (start_year IS NULL AND start_time IS NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX events_tour_id_idx ON events (tour_id)`);
    await queryRunner.query(`CREATE INDEX events_country_id_idx ON events (country_id)`);

    for (const owner of ['tour', 'event']) {
      const table = `${owner}s`;
      await queryRunner.query(`
        CREATE TABLE ${owner}_artists (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          ${owner}_id integer NOT NULL,
          artist_id integer NOT NULL,
          role live_artist_role NOT NULL,
          position smallint NOT NULL DEFAULT 0,
          credited_as varchar(200),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          CONSTRAINT ${owner}_artists_${owner}_id_artist_id_key UNIQUE (${owner}_id, artist_id),
          CONSTRAINT ${owner}_artists_${owner}_id_fkey FOREIGN KEY (${owner}_id) REFERENCES ${table} (id) ON DELETE RESTRICT,
          CONSTRAINT ${owner}_artists_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT,
          CONSTRAINT ${owner}_artists_position_nonnegative CHECK (position >= 0),
          CONSTRAINT ${owner}_artists_credited_as_nonblank CHECK (credited_as IS NULL OR btrim(credited_as) <> '')
        )
      `);
      await queryRunner.query(`CREATE INDEX ${owner}_artists_artist_id_idx ON ${owner}_artists (artist_id)`);

      await queryRunner.query(`
        CREATE TABLE ${owner}_organizers (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          ${owner}_id integer NOT NULL,
          catalog_identity_id integer NOT NULL,
          details text,
          position smallint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          CONSTRAINT ${owner}_organizers_${owner}_id_catalog_identity_id_key UNIQUE (${owner}_id, catalog_identity_id),
          CONSTRAINT ${owner}_organizers_${owner}_id_fkey FOREIGN KEY (${owner}_id) REFERENCES ${table} (id) ON DELETE RESTRICT,
          CONSTRAINT ${owner}_organizers_catalog_identity_id_fkey
            FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
          CONSTRAINT ${owner}_organizers_position_nonnegative CHECK (position >= 0)
        )
      `);
      await queryRunner.query(`CREATE INDEX ${owner}_organizers_catalog_identity_id_idx ON ${owner}_organizers (catalog_identity_id)`);
    }

    await queryRunner.query(`
      CREATE TABLE tour_links (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tour_id integer NOT NULL,
        label varchar(200) NOT NULL,
        url text NOT NULL,
        purpose live_link_purpose NOT NULL,
        country_id integer,
        position smallint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        -- A NULL country is the general page, so it is distinct from no other NULL.
        CONSTRAINT tour_links_tour_id_url_country_id_key UNIQUE NULLS NOT DISTINCT (tour_id, url, country_id),
        CONSTRAINT tour_links_tour_id_fkey FOREIGN KEY (tour_id) REFERENCES tours (id) ON DELETE RESTRICT,
        CONSTRAINT tour_links_country_id_fkey FOREIGN KEY (country_id) REFERENCES countries (id) ON DELETE RESTRICT,
        CONSTRAINT tour_links_label_nonblank CHECK (btrim(label) <> ''),
        CONSTRAINT tour_links_url_format CHECK (${URL_CHECK('url')}),
        CONSTRAINT tour_links_position_nonnegative CHECK (position >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX tour_links_country_id_idx ON tour_links (country_id)`);

    await queryRunner.query(`
      CREATE TABLE event_links (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_id integer NOT NULL,
        label varchar(200) NOT NULL,
        url text NOT NULL,
        purpose live_link_purpose NOT NULL,
        position smallint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT event_links_event_id_url_key UNIQUE (event_id, url),
        CONSTRAINT event_links_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE RESTRICT,
        CONSTRAINT event_links_label_nonblank CHECK (btrim(label) <> ''),
        CONSTRAINT event_links_url_format CHECK (${URL_CHECK('url')}),
        CONSTRAINT event_links_position_nonnegative CHECK (position >= 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['event_links', 'tour_links', 'event_organizers', 'tour_organizers', 'event_artists', 'tour_artists', 'events', 'tours']) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
    for (const type of ['live_link_purpose', 'live_artist_role', 'event_type', 'event_status', 'tour_status']) {
      await queryRunner.query(`DROP TYPE ${type}`);
    }
  }
}
