import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { APP_CONFIG, AppConfig, Frontend } from '../config/app-config';
import { AccountEmails } from './account-emails';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserToken } from './entities/user-token.entity';
import { hashPassword } from './passwords';
import { takenError } from './taken-errors';
import { IssuedUserToken, claimUserToken, issueUserToken } from './user-tokens';

export interface NewAccount {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

/** Registration and email verification. */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly emails: AccountEmails,
  ) {}

  /** Creates an active, unverified account and emails it a verification link once committed. */
  async register(account: NewAccount, frontend: Frontend): Promise<User> {
    const passwordHash = await hashPassword(account.password);
    const now = this.clock.now();
    try {
      const { user, token, tokenId } = await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          manager.create(User, {
            uuid: randomUUID(),
            username: account.username,
            email: account.email,
            displayName: account.displayName,
            avatarUrl: null,
            bio: null,
            emailVerified: false,
            status: 'active',
            role: 'user',
            createdAt: now,
            updatedAt: now,
            usernameChangedAt: now,
          }),
        );
        await manager.insert(UserCredential, {
          userId: user.id,
          passwordHash,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        return { user, ...(await this.issueVerificationToken(manager, user)) };
      });
      await this.emails.sendEmailVerification(user, frontend, token, tokenId);
      return user;
    } catch (error) {
      throw takenError(error) ?? error;
    }
  }

  /** Verifies the email of the account a verification token belongs to, consuming the token. */
  async verifyEmail(token: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const now = this.clock.now();
      const { user } = await claimUserToken(manager, token, 'email_verify', now);

      // Verifying consumes every pending verification token of the account, not just this one.
      await manager.update(UserToken, { userId: user.id, purpose: 'email_verify', usedAt: IsNull() }, { usedAt: now });
      await manager.update(User, { id: user.id }, { emailVerified: true, updatedAt: now });
    });
  }

  /** Emails the account a new verification link, unless its email is already verified. */
  async requestVerification(user: User, frontend: Frontend): Promise<void> {
    const { token, tokenId } = await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOneOrFail(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
      if (current.emailVerified) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'email_already_verified', detail: 'The email is already verified' },
        ]);
      }
      return this.issueVerificationToken(manager, current);
    });
    await this.emails.sendEmailVerification(user, frontend, token, tokenId);
  }

  private issueVerificationToken(manager: EntityManager, user: User): Promise<IssuedUserToken> {
    return issueUserToken(manager, user, 'email_verify', this.config.auth.emailVerificationTtlMs, this.clock.now());
  }
}
