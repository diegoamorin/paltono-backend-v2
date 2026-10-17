import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { APP_CONFIG, AppConfig, Frontend } from '../config/app-config';
import { AccountEmails } from './account-emails';
import { AuthSession } from './entities/auth-session.entity';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserToken } from './entities/user-token.entity';
import { hashPassword, requirePassword } from './passwords';
import { claimUserToken, issueUserToken } from './user-tokens';

/** Password recovery by email and password changes; both end every session of the account (ADR 0002). */
@Injectable()
export class PasswordsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly emails: AccountEmails,
  ) {}

  /**
   * Emails a reset link to the account with this email, if there is one that is
   * not deleted. The caller answers the same either way, and the email goes out
   * after this returns.
   */
  async requestReset(email: string, frontend: Frontend): Promise<void> {
    const issued = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where(`user.status <> 'deleted'`)
        .andWhere('lower(user.email) = lower(:email)', { email })
        .getOne();
      if (!user) return undefined;
      const now = this.clock.now();
      return { user, ...(await issueUserToken(manager, user, 'password_reset', this.config.auth.passwordResetTtlMs, now)) };
    });
    // Not awaited: waiting for the provider only when the account exists would reveal it through the response time.
    // Sending never rejects; failures are logged.
    if (issued) void this.emails.sendPasswordReset(issued.user, frontend, issued.token, issued.tokenId);
  }

  /**
   * Sets the password of the account a reset token belongs to, consuming the
   * token. Following the link proves control of the mailbox, so the email
   * becomes verified; every session of the account is revoked.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.dataSource.transaction(async (manager) => {
      const now = this.clock.now();
      const { user } = await claimUserToken(manager, token, 'password_reset', now);
      await this.replacePassword(manager, user, passwordHash, now);
      await manager.update(User, { id: user.id }, { emailVerified: true, updatedAt: now });
    });
  }

  /** Changes the password of an account that proves it knows the current one, revoking every session. */
  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    await this.dataSource.transaction(async (manager) => {
      await requirePassword(manager, user.id, currentPassword, 'currentPassword');
      await this.replacePassword(manager, user, passwordHash, this.clock.now());
    });
  }

  /** Stores the new password, consumes pending reset links and revokes every open session. */
  private async replacePassword(manager: EntityManager, user: User, passwordHash: string, now: Date): Promise<void> {
    await manager.update(UserCredential, { userId: user.id }, { passwordHash, passwordChangedAt: now, updatedAt: now });
    await manager.update(UserToken, { userId: user.id, purpose: 'password_reset', usedAt: IsNull() }, { usedAt: now });
    await manager.update(AuthSession, { userId: user.id, revokedAt: IsNull() }, { revokedAt: now });
  }
}
