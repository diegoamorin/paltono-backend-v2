import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * More dependent rows of the identity root: the types of an organization,
 * keyed by organization and type, and the platform links of any identity,
 * keyed by a generated id. Only applied microchanges write them.
 */
export class CreateIdentityLinks1792713600000 implements MigrationInterface {
  name = 'CreateIdentityLinks1792713600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE organization_type_assignments (
        organization_id integer NOT NULL,
        organization_type_id integer NOT NULL,
        CONSTRAINT organization_type_assignments_pkey PRIMARY KEY (organization_id, organization_type_id),
        CONSTRAINT organization_type_assignments_organization_id_fkey
          FOREIGN KEY (organization_id) REFERENCES organizations (catalog_identity_id) ON DELETE RESTRICT,
        CONSTRAINT organization_type_assignments_organization_type_id_fkey
          FOREIGN KEY (organization_type_id) REFERENCES organization_types (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX organization_type_assignments_organization_type_id_idx ON organization_type_assignments (organization_type_id)`,
    );

    // play_count is deferred beyond the MVP: it stays NULL and no write sets it.
    await queryRunner.query(`
      CREATE TABLE catalog_identity_platform_links (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        platform_id integer NOT NULL,
        catalog_identity_id integer NOT NULL,
        url varchar(2048) NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        play_count bigint,
        CONSTRAINT catalog_identity_platform_links_platform_id_fkey
          FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE RESTRICT,
        CONSTRAINT catalog_identity_platform_links_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        CONSTRAINT catalog_identity_platform_links_identity_platform_url_key UNIQUE (catalog_identity_id, platform_id, url),
        CONSTRAINT catalog_identity_platform_links_url_format CHECK (url ~* '^https?://[^\\s]+$'),
        CONSTRAINT catalog_identity_platform_links_play_count_nonnegative CHECK (play_count >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX catalog_identity_platform_links_platform_id_idx ON catalog_identity_platform_links (platform_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE catalog_identity_platform_links');
    await queryRunner.query('DROP TABLE organization_type_assignments');
  }
}
