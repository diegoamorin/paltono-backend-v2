import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A member holds at most one current membership in an organization. Neither
 * production nor the seed had two when this ran; if a database does, the
 * migration fails and a person fixes the data.
 */
export class AddOneCurrentMembership1793188800000 implements MigrationInterface {
  name = 'AddOneCurrentMembership1793188800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX organization_memberships_one_current ON organization_memberships (organization_id, member_identity_id) WHERE status = 'current'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX organization_memberships_one_current');
  }
}
