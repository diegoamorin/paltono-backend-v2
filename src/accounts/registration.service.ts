import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, QueryFailedError } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { APP_CONFIG, AppConfig, Frontend } from '../config/app-config';
import { AccountEmails } from './account-emails';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserToken } from './entities/user-token.entity';
import { hashPassword } from './passwords';
import { generateSecretToken, hashSecretToken } from './secret-tokens';

export interface NewAccount {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

const UNIQUE_VIOLATION = '23505';

/** The attribute behind each unique constraint a registration can collide with. */
const TAKEN_BY_CONSTRAINT: Record<string, 'username' | 'email'> = {
  users_username_key: 'username',
  users_email_key: 'email',
};

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
      const stored = await manager.findOne(UserToken, {
        where: { tokenHash: hashSecretToken(token), purpose: 'email_verify' },
        lock: { mode: 'pessimistic_write' },
      });
      const user = stored && (await manager.findOne(User, { where: { id: stored.userId }, lock: { mode: 'pessimistic_write' } }));
      if (!stored || !user || user.status === 'deleted') {
        throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [
          { code: 'token_invalid', detail: 'The token is not valid', source: { pointer: '/data/attributes/token' } },
        ]);
      }
      if (stored.usedAt) throw tokenStateError('token_used', 'The token has already been used');
      if (stored.expiresAt <= now) throw tokenStateError('token_expired', 'The token has expired');

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

  private async issueVerificationToken(manager: EntityManager, user: User): Promise<{ token: string; tokenId: number }> {
    const now = this.clock.now();
    const { token, hash } = generateSecretToken();
    const { identifiers } = await manager.insert(UserToken, {
      userId: user.id,
      purpose: 'email_verify',
      targetEmail: null,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + this.config.auth.emailVerificationTtlMs),
      createdAt: now,
    });
    return { token, tokenId: identifiers[0].id };
  }
}

function tokenStateError(code: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.CONFLICT, [{ code, detail, source: { pointer: '/data/attributes/token' } }]);
}

/** Turns a collision with another account's username or email into a 409. */
function takenError(error: unknown): JsonApiException | undefined {
  if (!(error instanceof QueryFailedError)) return undefined;
  const { code, constraint } = error.driverError as { code?: string; constraint?: string };
  const attribute = code === UNIQUE_VIOLATION && constraint ? TAKEN_BY_CONSTRAINT[constraint] : undefined;
  if (!attribute) return undefined;
  return new JsonApiException(HttpStatus.CONFLICT, [
    { code: `${attribute}_taken`, detail: `${attribute} is already taken`, source: { pointer: `/data/attributes/${attribute}` } },
  ]);
}
