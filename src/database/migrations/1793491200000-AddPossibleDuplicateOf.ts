import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The possible duplicate a creation is marked as: a published root of the
 * same type, kept apart from the payload, so no payload version changes. It
 * only warns moderation, and never reaches the entry.
 */
export class AddPossibleDuplicateOf1793491200000 implements MigrationInterface {
  name = 'AddPossibleDuplicateOf1793491200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE proposal_changes
        ADD COLUMN possible_duplicate_of uuid,
        ADD CONSTRAINT proposal_changes_possible_duplicate_of_fkey FOREIGN KEY (possible_duplicate_of) REFERENCES editorial_entities (id) ON DELETE RESTRICT,
        ADD CONSTRAINT proposal_changes_possible_duplicate_of_creation CHECK (possible_duplicate_of IS NULL OR operation = 'create_entity')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE proposal_changes DROP COLUMN possible_duplicate_of');
  }
}
