import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editorial contributions (docs/editorial-contributions.md §2): editorial roots,
 * proposals, microchanges, dependencies, sources, decisions and revisions, with
 * the composite foreign keys that keep every link inside one proposal. Also the
 * identity root's domain tables, `catalog_identities`, `people` and
 * `organizations`, which only applied creations fill. Every foreign key
 * restricts deletion: no history is removed by cascade.
 */
export class CreateEditorialContributions1792540800000 implements MigrationInterface {
  name = 'CreateEditorialContributions1792540800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE editorial_entity_type AS ENUM ('identity', 'work', 'recording', 'release_group', 'release', 'event', 'tour')`,
    );
    await queryRunner.query(`CREATE TYPE editorial_publication_status AS ENUM ('reserved', 'published', 'withdrawn')`);
    await queryRunner.query(`CREATE TYPE change_proposal_status AS ENUM ('draft', 'open', 'closed')`);
    await queryRunner.query(`
      CREATE TYPE proposal_change_operation AS ENUM (
        'create_entity', 'set_fields', 'add_relation', 'update_relation', 'remove_relation', 'withdraw_entity'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE proposal_change_status AS ENUM (
        'pending', 'conflicted', 'applied', 'rejected', 'satisfied', 'blocked', 'withdrawn'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE change_decision_action AS ENUM (
        'apply', 'apply_rebased', 'reject', 'mark_conflict', 'mark_satisfied', 'block_dependency', 'mark_obsolete', 'withdraw_change'
      )
    `);

    // The foreign key to the applied creation is added once proposal_changes exists.
    await queryRunner.query(`
      CREATE TABLE editorial_entities (
        id uuid PRIMARY KEY,
        entity_type editorial_entity_type NOT NULL,
        publication_status editorial_publication_status NOT NULL DEFAULT 'reserved',
        created_by integer NOT NULL,
        current_version bigint NOT NULL DEFAULT 0,
        creation_change_id uuid,
        created_at timestamptz NOT NULL,
        published_at timestamptz,
        withdrawn_at timestamptz,
        CONSTRAINT editorial_entities_creation_change_id_key UNIQUE (creation_change_id),
        CONSTRAINT editorial_entities_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT editorial_entities_current_version_nonnegative CHECK (current_version >= 0),
        -- A reservation has nothing applied yet; a published or withdrawn root has its creation and first publication.
        CONSTRAINT editorial_entities_publication CHECK (
          (publication_status = 'reserved' AND current_version = 0 AND creation_change_id IS NULL
            AND published_at IS NULL AND withdrawn_at IS NULL)
          OR (publication_status = 'published' AND current_version >= 1 AND creation_change_id IS NOT NULL
            AND published_at IS NOT NULL AND withdrawn_at IS NULL)
          OR (publication_status = 'withdrawn' AND current_version >= 1 AND creation_change_id IS NOT NULL
            AND published_at IS NOT NULL AND withdrawn_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX editorial_entities_created_by_idx ON editorial_entities (created_by)`);

    await queryRunner.query(`
      CREATE TABLE change_proposals (
        id uuid PRIMARY KEY,
        author_id integer NOT NULL,
        description text NOT NULL,
        status change_proposal_status NOT NULL DEFAULT 'draft',
        previous_proposal_id uuid,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        submitted_at timestamptz,
        closed_at timestamptz,
        CONSTRAINT change_proposals_author_id_fkey FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT change_proposals_previous_proposal_id_fkey
          FOREIGN KEY (previous_proposal_id) REFERENCES change_proposals (id) ON DELETE RESTRICT,
        CONSTRAINT change_proposals_not_own_predecessor CHECK (previous_proposal_id <> id),
        -- A draft may still lack its description; a submission never does.
        CONSTRAINT change_proposals_description_nonblank CHECK (status = 'draft' OR btrim(description) <> ''),
        CONSTRAINT change_proposals_lifecycle CHECK (
          (status = 'draft' AND submitted_at IS NULL AND closed_at IS NULL)
          OR (status = 'open' AND submitted_at IS NOT NULL AND closed_at IS NULL)
          OR (status = 'closed' AND submitted_at IS NOT NULL AND closed_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX change_proposals_author_id_created_at_idx ON change_proposals (author_id, created_at)`);
    await queryRunner.query(`CREATE INDEX change_proposals_status_submitted_at_idx ON change_proposals (status, submitted_at)`);
    await queryRunner.query(`CREATE INDEX change_proposals_previous_proposal_id_idx ON change_proposals (previous_proposal_id)`);

    await queryRunner.query(`
      CREATE TABLE proposal_changes (
        id uuid PRIMARY KEY,
        proposal_id uuid NOT NULL,
        entity_id uuid NOT NULL,
        operation proposal_change_operation NOT NULL,
        target_path varchar(100) NOT NULL,
        target_key jsonb,
        base_version bigint NOT NULL,
        base_value jsonb NOT NULL,
        proposed_value jsonb NOT NULL,
        payload_schema_version smallint NOT NULL,
        atomic_group_id uuid,
        position integer NOT NULL,
        status proposal_change_status NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL,
        resolved_at timestamptz,
        CONSTRAINT proposal_changes_proposal_id_id_key UNIQUE (proposal_id, id),
        CONSTRAINT proposal_changes_id_entity_id_key UNIQUE (id, entity_id),
        CONSTRAINT proposal_changes_proposal_id_position_key UNIQUE (proposal_id, position),
        CONSTRAINT proposal_changes_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES change_proposals (id) ON DELETE RESTRICT,
        CONSTRAINT proposal_changes_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT proposal_changes_base_version_nonnegative CHECK (base_version >= 0),
        CONSTRAINT proposal_changes_payload_schema_version_positive CHECK (payload_schema_version > 0),
        CONSTRAINT proposal_changes_position_nonnegative CHECK (position >= 0),
        -- Values are envelopes, so a removal proposes {"exists": false} rather than SQL NULL.
        CONSTRAINT proposal_changes_base_value_envelope CHECK (jsonb_typeof(base_value -> 'exists') = 'boolean'),
        CONSTRAINT proposal_changes_proposed_value_envelope CHECK (jsonb_typeof(proposed_value -> 'exists') = 'boolean'),
        -- Only the open states lack a resolution.
        CONSTRAINT proposal_changes_resolution CHECK ((status IN ('pending', 'conflicted')) = (resolved_at IS NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX proposal_changes_proposal_id_status_idx ON proposal_changes (proposal_id, status)`);
    await queryRunner.query(
      `CREATE INDEX proposal_changes_entity_id_target_path_status_idx ON proposal_changes (entity_id, target_path, status)`,
    );

    await queryRunner.query(`
      ALTER TABLE editorial_entities ADD CONSTRAINT editorial_entities_creation_change_fkey
        FOREIGN KEY (creation_change_id, id) REFERENCES proposal_changes (id, entity_id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE TABLE change_dependencies (
        change_id uuid NOT NULL,
        depends_on_change_id uuid NOT NULL,
        proposal_id uuid NOT NULL,
        CONSTRAINT change_dependencies_pkey PRIMARY KEY (change_id, depends_on_change_id),
        CONSTRAINT change_dependencies_change_fkey
          FOREIGN KEY (proposal_id, change_id) REFERENCES proposal_changes (proposal_id, id) ON DELETE RESTRICT,
        CONSTRAINT change_dependencies_depends_on_change_fkey
          FOREIGN KEY (proposal_id, depends_on_change_id) REFERENCES proposal_changes (proposal_id, id) ON DELETE RESTRICT,
        CONSTRAINT change_dependencies_not_self CHECK (change_id <> depends_on_change_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX change_dependencies_depends_on_change_id_idx ON change_dependencies (depends_on_change_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE proposal_sources (
        id uuid PRIMARY KEY,
        proposal_id uuid NOT NULL,
        url text,
        citation_text text,
        created_at timestamptz NOT NULL,
        CONSTRAINT proposal_sources_proposal_id_id_key UNIQUE (proposal_id, id),
        CONSTRAINT proposal_sources_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES change_proposals (id) ON DELETE RESTRICT,
        -- A web address, a bibliographic citation or both; a given URL is nonblank HTTP(S).
        CONSTRAINT proposal_sources_reference CHECK (
          (url IS NOT NULL AND btrim(url) <> '') OR (citation_text IS NOT NULL AND btrim(citation_text) <> '')
        ),
        CONSTRAINT proposal_sources_url_format CHECK (url IS NULL OR url ~* '^https?://[^\\s]+$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE change_sources (
        change_id uuid NOT NULL,
        source_id uuid NOT NULL,
        proposal_id uuid NOT NULL,
        CONSTRAINT change_sources_pkey PRIMARY KEY (change_id, source_id),
        CONSTRAINT change_sources_change_fkey
          FOREIGN KEY (proposal_id, change_id) REFERENCES proposal_changes (proposal_id, id) ON DELETE RESTRICT,
        CONSTRAINT change_sources_source_fkey
          FOREIGN KEY (proposal_id, source_id) REFERENCES proposal_sources (proposal_id, id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX change_sources_source_id_idx ON change_sources (source_id)`);

    await queryRunner.query(`
      CREATE TABLE change_decisions (
        id uuid PRIMARY KEY,
        change_id uuid NOT NULL,
        actor_id integer,
        action change_decision_action NOT NULL,
        previous_status proposal_change_status NOT NULL,
        resulting_status proposal_change_status NOT NULL,
        reason text,
        observed_version bigint NOT NULL,
        observed_value jsonb,
        decided_at timestamptz NOT NULL,
        CONSTRAINT change_decisions_id_change_id_key UNIQUE (id, change_id),
        CONSTRAINT change_decisions_change_id_fkey FOREIGN KEY (change_id) REFERENCES proposal_changes (id) ON DELETE RESTRICT,
        CONSTRAINT change_decisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT change_decisions_observed_version_nonnegative CHECK (observed_version >= 0),
        -- Only an automatic decision on a microchange whose obsolete payload schema version cannot be read observes nothing.
        CONSTRAINT change_decisions_observed_value_envelope CHECK (
          (observed_value IS NOT NULL AND jsonb_typeof(observed_value -> 'exists') = 'boolean')
          OR (observed_value IS NULL AND actor_id IS NULL AND action IN ('mark_obsolete', 'block_dependency'))
        ),
        -- Decisions act on open states and each action has its own outcome.
        CONSTRAINT change_decisions_previous_status_open CHECK (previous_status IN ('pending', 'conflicted')),
        CONSTRAINT change_decisions_outcome CHECK (
          (action IN ('apply', 'apply_rebased') AND resulting_status = 'applied')
          OR (action = 'reject' AND resulting_status = 'rejected')
          OR (action = 'mark_conflict' AND resulting_status = 'conflicted')
          OR (action = 'mark_satisfied' AND resulting_status = 'satisfied')
          OR (action IN ('block_dependency', 'mark_obsolete') AND resulting_status = 'blocked')
          OR (action = 'withdraw_change' AND resulting_status = 'withdrawn')
        ),
        -- Only the system's automatic marks go without an actor; nothing is approved automatically.
        CONSTRAINT change_decisions_actor CHECK (
          actor_id IS NOT NULL OR action IN ('mark_conflict', 'mark_satisfied', 'block_dependency', 'mark_obsolete')
        ),
        CONSTRAINT change_decisions_reason CHECK (
          action NOT IN ('mark_conflict', 'reject', 'apply_rebased', 'block_dependency', 'mark_obsolete')
          OR (reason IS NOT NULL AND btrim(reason) <> '')
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX change_decisions_change_id_decided_at_idx ON change_decisions (change_id, decided_at)`);

    await queryRunner.query(`
      CREATE TABLE entity_revisions (
        id uuid PRIMARY KEY,
        entity_id uuid NOT NULL,
        version bigint NOT NULL,
        change_id uuid NOT NULL,
        decision_id uuid NOT NULL,
        before_value jsonb NOT NULL,
        after_value jsonb NOT NULL,
        result_key jsonb,
        applied_at timestamptz NOT NULL,
        CONSTRAINT entity_revisions_entity_id_version_key UNIQUE (entity_id, version),
        CONSTRAINT entity_revisions_change_id_key UNIQUE (change_id),
        CONSTRAINT entity_revisions_decision_id_key UNIQUE (decision_id),
        CONSTRAINT entity_revisions_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT entity_revisions_change_fkey
          FOREIGN KEY (change_id, entity_id) REFERENCES proposal_changes (id, entity_id) ON DELETE RESTRICT,
        CONSTRAINT entity_revisions_decision_fkey
          FOREIGN KEY (decision_id, change_id) REFERENCES change_decisions (id, change_id) ON DELETE RESTRICT,
        CONSTRAINT entity_revisions_version_positive CHECK (version > 0),
        CONSTRAINT entity_revisions_before_value_envelope CHECK (jsonb_typeof(before_value -> 'exists') = 'boolean'),
        CONSTRAINT entity_revisions_after_value_envelope CHECK (jsonb_typeof(after_value -> 'exists') = 'boolean')
      )
    `);

    await queryRunner.query(`CREATE TYPE catalog_identity_type AS ENUM ('person', 'organization')`);
    await queryRunner.query(`CREATE TYPE person_gender AS ENUM ('male', 'female', 'other')`);

    await queryRunner.query(`
      CREATE TABLE catalog_identities (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        display_name varchar(200) NOT NULL,
        type catalog_identity_type NOT NULL,
        img_profile varchar(2048),
        bio text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        editorial_entity_id uuid NOT NULL,
        CONSTRAINT catalog_identities_uuid_key UNIQUE (uuid),
        CONSTRAINT catalog_identities_public_id_key UNIQUE (public_id),
        CONSTRAINT catalog_identities_editorial_entity_id_key UNIQUE (editorial_entity_id),
        CONSTRAINT catalog_identities_editorial_entity_id_fkey
          FOREIGN KEY (editorial_entity_id) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        CONSTRAINT catalog_identities_display_name_nonblank CHECK (btrim(display_name) <> ''),
        CONSTRAINT catalog_identities_img_profile_format CHECK (img_profile IS NULL OR img_profile ~* '^https?://[^\\s]+$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE people (
        catalog_identity_id integer PRIMARY KEY,
        given_name varchar(200),
        family_name varchar(200),
        birth_date date,
        birth_country_id integer,
        death_date date,
        height_cm smallint,
        gender person_gender,
        img_full_body varchar(2048),
        CONSTRAINT people_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        CONSTRAINT people_birth_country_id_fkey
          FOREIGN KEY (birth_country_id) REFERENCES countries (id) ON DELETE RESTRICT,
        CONSTRAINT people_height_cm_range CHECK (height_cm BETWEEN 1 AND 300),
        CONSTRAINT people_lifespan CHECK (death_date >= birth_date),
        CONSTRAINT people_img_full_body_format CHECK (img_full_body IS NULL OR img_full_body ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX people_birth_country_id_idx ON people (birth_country_id)`);

    // Founding and dissolution are partial dates: a month needs its year, a day its month, and the day must exist.
    await queryRunner.query(`
      CREATE TABLE organizations (
        catalog_identity_id integer PRIMARY KEY,
        legal_name varchar(200),
        founding_year smallint,
        founding_month smallint,
        founding_day smallint,
        dissolution_year smallint,
        dissolution_month smallint,
        dissolution_day smallint,
        origin_country_id integer,
        CONSTRAINT organizations_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        CONSTRAINT organizations_origin_country_id_fkey
          FOREIGN KEY (origin_country_id) REFERENCES countries (id) ON DELETE RESTRICT,
        CONSTRAINT organizations_founding_date CHECK (
          (founding_year IS NULL OR founding_year BETWEEN 1 AND 9999)
          AND (founding_month IS NULL OR (founding_year IS NOT NULL AND founding_month BETWEEN 1 AND 12))
          AND (founding_day IS NULL OR (founding_month IS NOT NULL
            AND founding_day BETWEEN 1 AND extract(day FROM make_date(founding_year, founding_month, 1) + interval '1 month - 1 day')))
        ),
        CONSTRAINT organizations_dissolution_date CHECK (
          (dissolution_year IS NULL OR dissolution_year BETWEEN 1 AND 9999)
          AND (dissolution_month IS NULL OR (dissolution_year IS NOT NULL AND dissolution_month BETWEEN 1 AND 12))
          AND (dissolution_day IS NULL OR (dissolution_month IS NOT NULL
            AND dissolution_day BETWEEN 1 AND extract(day FROM make_date(dissolution_year, dissolution_month, 1) + interval '1 month - 1 day')))
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX organizations_origin_country_id_idx ON organizations (origin_country_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE organizations');
    await queryRunner.query('DROP TABLE people');
    await queryRunner.query('DROP TABLE catalog_identities');
    await queryRunner.query('DROP TYPE person_gender');
    await queryRunner.query('DROP TYPE catalog_identity_type');
    await queryRunner.query('DROP TABLE entity_revisions');
    await queryRunner.query('DROP TABLE change_decisions');
    await queryRunner.query('DROP TABLE change_sources');
    await queryRunner.query('DROP TABLE proposal_sources');
    await queryRunner.query('DROP TABLE change_dependencies');
    await queryRunner.query('ALTER TABLE editorial_entities DROP CONSTRAINT editorial_entities_creation_change_fkey');
    await queryRunner.query('DROP TABLE proposal_changes');
    await queryRunner.query('DROP TABLE change_proposals');
    await queryRunner.query('DROP TABLE editorial_entities');
    await queryRunner.query('DROP TYPE change_decision_action');
    await queryRunner.query('DROP TYPE proposal_change_status');
    await queryRunner.query('DROP TYPE proposal_change_operation');
    await queryRunner.query('DROP TYPE change_proposal_status');
    await queryRunner.query('DROP TYPE editorial_publication_status');
    await queryRunner.query('DROP TYPE editorial_entity_type');
  }
}
