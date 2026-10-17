import { MigrationInterface, QueryRunner } from 'typeorm';

/** Global search runs in PostgreSQL with `pg_trgm` and `unaccent` (ADR 0004). */
export class EnableSearchExtensions1792195200000 implements MigrationInterface {
  name = 'EnableSearchExtensions1792195200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS unaccent');
    await queryRunner.query('DROP EXTENSION IF EXISTS pg_trgm');
  }
}
