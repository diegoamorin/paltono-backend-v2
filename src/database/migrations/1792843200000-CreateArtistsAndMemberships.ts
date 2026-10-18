import { MigrationInterface, QueryRunner } from 'typeorm';

const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

/**
 * The artist profile of an identity, the memberships of organizations with
 * their roles, and the affiliations of artists with agencies, labels and
 * management. All belong to the identity root: the profile and its
 * affiliations to the artist's identity, memberships and their roles to the
 * organization. Only applied microchanges write them. Acyclic memberships,
 * overlapping periods and self-affiliation span rows, so the editorial flow
 * checks them under the locks of both identities.
 */
export class CreateArtistsAndMemberships1792843200000 implements MigrationInterface {
  name = 'CreateArtistsAndMemberships1792843200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE artists (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        public_id varchar(21) NOT NULL,
        catalog_identity_id integer NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT artists_uuid_key UNIQUE (uuid),
        CONSTRAINT artists_public_id_key UNIQUE (public_id),
        CONSTRAINT artists_catalog_identity_id_key UNIQUE (catalog_identity_id),
        CONSTRAINT artists_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`CREATE TYPE association_status AS ENUM ('current', 'former', 'unknown')`);

    await queryRunner.query(`
      CREATE TABLE organization_memberships (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        organization_id integer NOT NULL,
        member_identity_id integer NOT NULL,
        joined_year smallint,
        joined_month smallint,
        joined_day smallint,
        left_year smallint,
        left_month smallint,
        left_day smallint,
        description text,
        status association_status NOT NULL DEFAULT 'unknown',
        source_text text,
        source_url varchar(2048),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT organization_memberships_organization_id_fkey
          FOREIGN KEY (organization_id) REFERENCES organizations (catalog_identity_id) ON DELETE RESTRICT,
        CONSTRAINT organization_memberships_member_identity_id_fkey
          FOREIGN KEY (member_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        CONSTRAINT organization_memberships_period_key
          UNIQUE NULLS NOT DISTINCT (organization_id, member_identity_id, joined_year, joined_month, joined_day),
        CONSTRAINT organization_memberships_not_self CHECK (organization_id <> member_identity_id),
        CONSTRAINT organization_memberships_joined_date CHECK (${partialDateCheck('joined')}),
        CONSTRAINT organization_memberships_left_date CHECK (${partialDateCheck('left')}),
        CONSTRAINT organization_memberships_status CHECK (
          (left_year IS NULL OR status = 'former') AND (status <> 'current' OR left_year IS NULL)
        ),
        CONSTRAINT organization_memberships_source_url_format CHECK (source_url IS NULL OR source_url ~* '^https?://[^\\s]+$')
      )
    `);
    await queryRunner.query(`CREATE INDEX organization_memberships_member_identity_id_idx ON organization_memberships (member_identity_id)`);

    // A role is only usable where its scopes allow, through the (role, scope) pair.
    await queryRunner.query(`
      CREATE TABLE organization_membership_roles (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        organization_membership_id integer NOT NULL,
        contribution_role_id integer NOT NULL,
        role_scope contribution_role_scope NOT NULL DEFAULT 'membership',
        position smallint NOT NULL,
        details text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT organization_membership_roles_organization_membership_id_fkey
          FOREIGN KEY (organization_membership_id) REFERENCES organization_memberships (id) ON DELETE RESTRICT,
        CONSTRAINT organization_membership_roles_role_fkey
          FOREIGN KEY (contribution_role_id, role_scope) REFERENCES contribution_role_scopes (contribution_role_id, scope) ON DELETE RESTRICT,
        CONSTRAINT organization_membership_roles_membership_role_key UNIQUE (organization_membership_id, contribution_role_id),
        CONSTRAINT organization_membership_roles_role_scope CHECK (role_scope = 'membership'),
        CONSTRAINT organization_membership_roles_position_nonnegative CHECK (position >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX organization_membership_roles_contribution_role_id_idx ON organization_membership_roles (contribution_role_id, role_scope)`,
    );

    await queryRunner.query(`CREATE TYPE affiliation_relationship_type AS ENUM ('agency', 'label', 'management')`);
    await queryRunner.query(`
      CREATE TABLE artist_organization_affiliations (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        artist_id integer NOT NULL,
        organization_id integer NOT NULL,
        relationship_type affiliation_relationship_type NOT NULL,
        started_at date,
        ended_at date,
        status association_status NOT NULL DEFAULT 'unknown',
        description text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT artist_organization_affiliations_artist_id_fkey
          FOREIGN KEY (artist_id) REFERENCES artists (id) ON DELETE RESTRICT,
        CONSTRAINT artist_organization_affiliations_organization_id_fkey
          FOREIGN KEY (organization_id) REFERENCES organizations (catalog_identity_id) ON DELETE RESTRICT,
        CONSTRAINT artist_organization_affiliations_period_key
          UNIQUE NULLS NOT DISTINCT (artist_id, organization_id, relationship_type, started_at),
        CONSTRAINT artist_organization_affiliations_interval CHECK (ended_at >= started_at),
        CONSTRAINT artist_organization_affiliations_status CHECK (
          (ended_at IS NULL OR status = 'former') AND (status <> 'current' OR ended_at IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX artist_organization_affiliations_organization_id_idx ON artist_organization_affiliations (organization_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE artist_organization_affiliations');
    await queryRunner.query('DROP TYPE affiliation_relationship_type');
    await queryRunner.query('DROP TABLE organization_membership_roles');
    await queryRunner.query('DROP TABLE organization_memberships');
    await queryRunner.query('DROP TYPE association_status');
    await queryRunner.query('DROP TABLE artists');
  }
}
