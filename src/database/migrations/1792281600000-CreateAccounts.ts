import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounts and local authentication (ADR 0002): `users`, `user_credentials`,
 * `user_tokens` and `auth_sessions`, with the constraints the ER documents.
 */
export class CreateAccounts1792281600000 implements MigrationInterface {
  name = 'CreateAccounts1792281600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted')`);
    await queryRunner.query(`CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin')`);
    await queryRunner.query(`CREATE TYPE user_token_purpose AS ENUM ('email_verify', 'password_reset', 'email_change')`);

    await queryRunner.query(`
      CREATE TABLE users (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uuid uuid NOT NULL,
        username varchar(30) NOT NULL,
        email varchar(254),
        display_name varchar(100) NOT NULL,
        avatar_url varchar(2048),
        bio text,
        email_verified boolean NOT NULL DEFAULT false,
        status user_status NOT NULL DEFAULT 'active',
        role user_role NOT NULL DEFAULT 'user',
        last_login_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        username_changed_at timestamptz NOT NULL,
        CONSTRAINT users_uuid_key UNIQUE (uuid),
        CONSTRAINT users_username_key UNIQUE (username),
        -- Lowercase ASCII letters, digits, _ and ., 1 to 30 characters, no trailing period.
        CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_.]{0,29}[a-z0-9_]$'),
        -- Only a deleted account may lose its email; a present email is nonblank and well formed.
        CONSTRAINT users_email_required CHECK (email IS NOT NULL OR status = 'deleted'),
        CONSTRAINT users_email_format CHECK (email IS NULL OR email ~ '^[^@\\s]+@[^@\\s]+$'),
        CONSTRAINT users_display_name_nonblank CHECK (btrim(display_name) <> '')
      )
    `);
    // Case-insensitive uniqueness of every non-NULL email, whatever the account status.
    await queryRunner.query(`CREATE UNIQUE INDEX users_email_key ON users (lower(email))`);

    await queryRunner.query(`
      CREATE TABLE user_credentials (
        user_id integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        password_hash varchar(255) NOT NULL,
        password_changed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE user_tokens (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        purpose user_token_purpose NOT NULL,
        target_email varchar(254),
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL,
        CONSTRAINT user_tokens_token_hash_key UNIQUE (token_hash),
        -- Only an email change is bound to a destination, which is a normalized, well-formed email.
        CONSTRAINT user_tokens_target_email_purpose CHECK ((purpose = 'email_change') = (target_email IS NOT NULL)),
        CONSTRAINT user_tokens_target_email_format CHECK (
          target_email IS NULL OR (target_email ~ '^[^@\\s]+@[^@\\s]+$' AND target_email = lower(target_email))
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX user_tokens_user_id_purpose_idx ON user_tokens (user_id, purpose)`);

    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        user_agent varchar(512) NOT NULL,
        ip_address inet NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL,
        CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(`CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE auth_sessions');
    await queryRunner.query('DROP TABLE user_tokens');
    await queryRunner.query('DROP TABLE user_credentials');
    await queryRunner.query('DROP TABLE users');
    await queryRunner.query('DROP TYPE user_token_purpose');
    await queryRunner.query('DROP TYPE user_role');
    await queryRunner.query('DROP TYPE user_status');
  }
}
