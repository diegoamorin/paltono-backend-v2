import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { APP_CONFIG, AppConfig, Frontend } from '../config/app-config';
import { AccountEmails } from './account-emails';
import { User } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { requirePassword } from './passwords';
import { takenConflict, takenError } from './taken-errors';
import { claimUserToken, issueUserToken } from './user-tokens';

/**
 * Email changes (ADR 0002): the account proves its password and the new address
 * proves its mailbox through an emailed link. The old email stays until then.
 */
@Injectable()
export class EmailChangesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly emails: AccountEmails,
  ) {}

  /**
   * Emails a confirmation link to `newEmail`, lowercase, once the password is
   * right and no account holds that address. Any earlier pending change of the
   * account is cancelled, so only the latest address requested can be confirmed.
   */
  async request(user: User, currentPassword: string, newEmail: string, frontend: Frontend): Promise<void> {
    const { current, token, tokenId } = await this.dataSource.transaction(async (manager) => {
      const now = this.clock.now();
      const current = await manager.findOneOrFail(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
      await requirePassword(manager, current.id, currentPassword, 'currentPassword');
      if (current.email?.toLowerCase() === newEmail) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'email_unchanged', detail: 'The new email is the current one', source: { pointer: '/data/attributes/newEmail' } },
        ]);
      }
      await requireEmailFree(manager, newEmail, 'newEmail');

      await manager.update(UserToken, { userId: current.id, purpose: 'email_change', usedAt: IsNull() }, { usedAt: now });
      const issued = await issueUserToken(manager, current, 'email_change', this.config.auth.emailChangeTtlMs, now, newEmail);
      return { current, ...issued };
    });
    await this.emails.sendEmailChange(current, newEmail, frontend, token, tokenId);
  }

  /**
   * Gives the account of an email change token the address the token is bound
   * to, verified, consuming the token. The address must still be free: that is
   * checked with the account locked and enforced by the unique index, so of two
   * accounts confirming it at once only one gets it. Every other pending token of
   * the account ends, including reset links sent to the old address.
   */
  async confirm(token: string): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const now = this.clock.now();
        const { stored, user } = await claimUserToken(manager, token, 'email_change', now);
        await requireEmailFree(manager, stored.targetEmail!, 'token');

        await manager.update(UserToken, { userId: user.id, usedAt: IsNull() }, { usedAt: now });
        await manager.update(User, { id: user.id }, { email: stored.targetEmail, emailVerified: true, updatedAt: now });
      });
    } catch (error) {
      throw takenError(error, 'token') ?? error;
    }
  }
}

/** Refuses an email some account already holds; deleted accounts hold none. */
async function requireEmailFree(manager: EntityManager, email: string, attribute: string): Promise<void> {
  const holder = await manager
    .createQueryBuilder(User, 'user')
    .where('lower(user.email) = :email', { email })
    .getExists();
  if (holder) throw takenConflict('email', attribute);
}
