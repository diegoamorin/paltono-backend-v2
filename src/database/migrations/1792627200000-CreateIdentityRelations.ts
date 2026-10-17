import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dependent rows of the identity root that relation changes add, update and
 * remove: aliases, keyed by a generated id, and the nationalities of people,
 * keyed by person and country. Only applied microchanges write them.
 */
export class CreateIdentityRelations1792627200000 implements MigrationInterface {
  name = 'CreateIdentityRelations1792627200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE catalog_identity_aliases (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        catalog_identity_id integer NOT NULL,
        alias varchar(200) NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        sort_order smallint NOT NULL DEFAULT 0,
        CONSTRAINT catalog_identity_aliases_catalog_identity_id_fkey
          FOREIGN KEY (catalog_identity_id) REFERENCES catalog_identities (id) ON DELETE RESTRICT,
        CONSTRAINT catalog_identity_aliases_catalog_identity_id_alias_key UNIQUE (catalog_identity_id, alias),
        CONSTRAINT catalog_identity_aliases_alias_nonblank CHECK (btrim(alias) <> ''),
        CONSTRAINT catalog_identity_aliases_sort_order_nonnegative CHECK (sort_order >= 0)
      )
    `);
    // At most one primary alias per identity.
    await queryRunner.query(`
      CREATE UNIQUE INDEX catalog_identity_aliases_primary_key ON catalog_identity_aliases (catalog_identity_id) WHERE is_primary
    `);

    await queryRunner.query(`
      CREATE TABLE person_nationalities (
        person_id integer NOT NULL,
        country_id integer NOT NULL,
        CONSTRAINT person_nationalities_pkey PRIMARY KEY (person_id, country_id),
        CONSTRAINT person_nationalities_person_id_fkey
          FOREIGN KEY (person_id) REFERENCES people (catalog_identity_id) ON DELETE RESTRICT,
        CONSTRAINT person_nationalities_country_id_fkey
          FOREIGN KEY (country_id) REFERENCES countries (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX person_nationalities_country_id_idx ON person_nationalities (country_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE person_nationalities');
    await queryRunner.query('DROP TABLE catalog_identity_aliases');
  }
}
