import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Role audit (`user_role_changes`, ADR 0003) and the shared vocabularies that
 * administrators manage outside the editorial flow: `countries`, `genres`,
 * `platforms`, `organization_types`, `contribution_roles` and
 * `contribution_role_scopes`. Every foreign key restricts deletion, so an entry
 * in use is never removed by cascade.
 */
export class CreateRolesAndVocabularies1792368000000 implements MigrationInterface {
  name = 'CreateRolesAndVocabularies1792368000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_role_changes (
        id uuid PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
        changed_by integer REFERENCES users (id) ON DELETE RESTRICT,
        previous_role user_role NOT NULL,
        new_role user_role NOT NULL,
        reason text,
        changed_at timestamptz NOT NULL,
        CONSTRAINT user_role_changes_role_changed CHECK (previous_role <> new_role),
        -- No acting administrator only for the console bootstrap, which promotes to admin with a reason.
        CONSTRAINT user_role_changes_bootstrap CHECK (
          changed_by IS NOT NULL OR (new_role = 'admin' AND reason IS NOT NULL AND btrim(reason) <> '')
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX user_role_changes_user_id_changed_at_idx ON user_role_changes (user_id, changed_at)`);

    await queryRunner.query(`
      CREATE TABLE countries (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code char(2) NOT NULL,
        name varchar(100) NOT NULL,
        CONSTRAINT countries_code_key UNIQUE (code),
        CONSTRAINT countries_code_format CHECK (code ~ '^[A-Z]{2}$'),
        CONSTRAINT countries_name_nonblank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE genres (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug varchar(64) NOT NULL,
        name varchar(100) NOT NULL,
        CONSTRAINT genres_slug_key UNIQUE (slug),
        CONSTRAINT genres_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT genres_name_nonblank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE platforms (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(100) NOT NULL,
        slug varchar(64) NOT NULL,
        icon_url varchar(2048) NOT NULL,
        supports_catalog_identity boolean NOT NULL DEFAULT false,
        supports_track boolean NOT NULL DEFAULT false,
        supports_album boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT platforms_name_key UNIQUE (name),
        CONSTRAINT platforms_slug_key UNIQUE (slug),
        CONSTRAINT platforms_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT platforms_name_nonblank CHECK (btrim(name) <> ''),
        CONSTRAINT platforms_icon_url_format CHECK (icon_url ~ '^https?://')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE organization_types (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug varchar(64) NOT NULL,
        name varchar(100) NOT NULL,
        description text,
        CONSTRAINT organization_types_slug_key UNIQUE (slug),
        CONSTRAINT organization_types_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT organization_types_name_nonblank CHECK (btrim(name) <> '')
      )
    `);

    await queryRunner.query(
      `CREATE TYPE contribution_role_category AS ENUM ('writing', 'arrangement', 'performance', 'production', 'engineering')`,
    );
    await queryRunner.query(`CREATE TYPE contribution_role_scope AS ENUM ('work', 'recording', 'release', 'membership')`);

    await queryRunner.query(`
      CREATE TABLE contribution_roles (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug varchar(64) NOT NULL,
        name varchar(100) NOT NULL,
        description text,
        category contribution_role_category NOT NULL,
        CONSTRAINT contribution_roles_slug_key UNIQUE (slug),
        CONSTRAINT contribution_roles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT contribution_roles_name_nonblank CHECK (btrim(name) <> '')
      )
    `);

    // Credits and membership roles reference a (role, scope) pair, so a role is only usable in its scopes.
    await queryRunner.query(`
      CREATE TABLE contribution_role_scopes (
        contribution_role_id integer NOT NULL REFERENCES contribution_roles (id) ON DELETE RESTRICT,
        scope contribution_role_scope NOT NULL,
        PRIMARY KEY (contribution_role_id, scope)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE contribution_role_scopes');
    await queryRunner.query('DROP TABLE contribution_roles');
    await queryRunner.query('DROP TYPE contribution_role_scope');
    await queryRunner.query('DROP TYPE contribution_role_category');
    await queryRunner.query('DROP TABLE organization_types');
    await queryRunner.query('DROP TABLE platforms');
    await queryRunner.query('DROP TABLE genres');
    await queryRunner.query('DROP TABLE countries');
    await queryRunner.query('DROP TABLE user_role_changes');
  }
}
