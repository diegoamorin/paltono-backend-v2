import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { RegistrationService } from '../accounts/registration.service';
import { bootstrapAdministrator, changeRole } from '../accounts/role-changes';
import { changeStatus, deleteOwnAccount } from '../accounts/status-changes';
import { issueUserToken } from '../accounts/user-tokens';
import { Clock } from '../common/clock/clock';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/** The password of every seeded account, so developers can log in as any of them. */
export const SEED_PASSWORD = 'paltono-seed-2026';

/** The accounts the catalog seed acts with. The suspended and deleted ones contribute before losing their access. */
export interface SeedAccounts {
  admin: User;
  /** The seed's moderator, who reviews every submission and publishes directly. */
  moderator: User;
  /** Verified contributors who submit proposals. */
  editor: User;
  contributor: User;
  /** Accounts that contribute first and are then suspended or deleted. */
  suspended: User;
  deleted: User;
}

/**
 * Registers the seed accounts through the same services as the API: a
 * registration with its verification email, which goes nowhere, and a
 * verification by token. Roles and statuses change with their audit.
 */
export class AccountSeeder {
  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly registration: RegistrationService;
  private readonly config: AppConfig;

  constructor(app: INestApplicationContext) {
    this.dataSource = app.get(DataSource);
    this.clock = app.get(Clock);
    this.registration = app.get(RegistrationService);
    this.config = app.get(APP_CONFIG);
  }

  async createAccounts(): Promise<SeedAccounts> {
    const admin = await this.register('seed_admin', 'Administración del seed');
    await this.dataSource.transaction((manager) =>
      bootstrapAdministrator(manager, admin.username, 'Primer administrador del seed de desarrollo', this.clock.now()),
    );
    const moderator = await this.register('seed_moderadora', 'Moderadora del seed');
    await this.dataSource.transaction((manager) =>
      changeRole(manager, {
        actorId: admin.id,
        userUuid: moderator.uuid,
        newRole: 'moderator',
        reason: 'Revisa y publica el catálogo del seed',
        now: this.clock.now(),
      }),
    );
    await this.register('seed_sin_verificar', 'Cuenta sin verificar', { verified: false });
    return {
      admin: await this.reload(admin),
      moderator: await this.reload(moderator),
      editor: await this.register('seed_editora', 'Editora K-pop'),
      contributor: await this.register('seed_colaborador', 'Colaborador K-pop'),
      suspended: await this.register('seed_suspendida', 'Cuenta suspendida'),
      deleted: await this.register('seed_eliminada', 'Cuenta eliminada'),
    };
  }

  /** Suspends an account on behalf of the administrator, with its audit. */
  async suspend(admin: User, user: User): Promise<void> {
    await this.dataSource.transaction((manager) =>
      changeStatus(manager, {
        actorId: admin.id,
        userUuid: user.uuid,
        newStatus: 'suspended',
        reason: 'Cuenta suspendida de ejemplo del seed',
        now: this.clock.now(),
      }),
    );
  }

  /** Deletes an account at its own request, as `POST /v1/account-deletions` does. */
  async deleteOwn(user: User): Promise<void> {
    await this.dataSource.transaction((manager) => deleteOwnAccount(manager, user.id, SEED_PASSWORD, this.clock.now()));
  }

  private async register(username: string, displayName: string, { verified = true } = {}): Promise<User> {
    const user = await this.registration.register(
      { username, email: `${username}@example.com`, password: SEED_PASSWORD, displayName },
      'kpop',
    );
    if (verified) {
      // The emailed token is not stored, so the seed issues its own and redeems it like the link would.
      const { token } = await this.dataSource.transaction((manager) =>
        issueUserToken(manager, user, 'email_verify', this.config.auth.emailVerificationTtlMs, this.clock.now()),
      );
      await this.registration.verifyEmail(token);
    }
    return this.reload(user);
  }

  private reload(user: User): Promise<User> {
    return this.dataSource.manager.findOneByOrFail(User, { id: user.id });
  }
}
