import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Status audit (`user_status_changes`): suspensions, reactivations and
 * deletions, each written in the transaction that updates `users.status`.
 */
export class CreateUserStatusChanges1792454400000 implements MigrationInterface {
  name = 'CreateUserStatusChanges1792454400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_status_changes (
        id uuid PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
        changed_by integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
        previous_status user_status NOT NULL,
        new_status user_status NOT NULL,
        reason text,
        changed_at timestamptz NOT NULL,
        -- deleted is terminal: every transition starts from active or suspended.
        CONSTRAINT user_status_changes_transition CHECK (
          (previous_status, new_status) IN (('active', 'suspended'), ('suspended', 'active'), ('active', 'deleted'), ('suspended', 'deleted'))
        ),
        -- An active account is only deleted by itself; an administrator deletes suspended accounts.
        CONSTRAINT user_status_changes_voluntary_deletion CHECK (
          NOT (previous_status = 'active' AND new_status = 'deleted') OR changed_by = user_id
        ),
        -- Only a voluntary deletion, made by the account itself, may go without a reason.
        CONSTRAINT user_status_changes_reason CHECK (
          (reason IS NOT NULL AND btrim(reason) <> '')
          OR (previous_status = 'active' AND new_status = 'deleted' AND changed_by = user_id)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX user_status_changes_user_id_changed_at_idx ON user_status_changes (user_id, changed_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE user_status_changes');
  }
}
