import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery } from '../common/json-api/query';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccessTokens } from './access-tokens';
import { AuthSession } from './entities/auth-session.entity';
import { User } from './entities/user.entity';
import { UserCredential } from './entities/user-credential.entity';
import { hashPassword, verifyPassword } from './passwords';
import { generateSecretToken, hashSecretToken } from './secret-tokens';

export interface LoginAttempt {
  /** Username or email. */
  identifier: string;
  password: string;
  userAgent: string;
  ipAddress: string;
}

export interface NewSession {
  session: AuthSession;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

/** The account and session behind an authenticated request. */
export interface Authentication {
  user: User;
  session: AuthSession;
}

/** Login, logout and the per-request check of session and account state. */
@Injectable()
export class SessionsService {
  /** Verified against when no account matches, so both cases take as long. */
  private readonly decoyHash = hashPassword('decoy password for unknown accounts');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly accessTokens: AccessTokens,
  ) {}

  /**
   * Opens a session for the account whose username or email matches. Unknown
   * accounts and wrong passwords get the same answer; a suspended account learns
   * it is suspended only after giving the right password.
   */
  async login(attempt: LoginAttempt): Promise<NewSession> {
    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .where(`user.status <> 'deleted'`)
      .andWhere('(user.username = lower(:identifier) OR lower(user.email) = lower(:identifier))', {
        identifier: attempt.identifier.trim(),
      })
      .getOne();
    const credential = user && (await this.dataSource.getRepository(UserCredential).findOneBy({ userId: user.id }));
    const passwordMatches = await verifyPassword(credential?.passwordHash ?? (await this.decoyHash), attempt.password);

    if (!user || !credential || !passwordMatches) {
      throw new JsonApiException(HttpStatus.UNAUTHORIZED, [
        { code: 'invalid_credentials', detail: 'The username, email or password is incorrect' },
      ]);
    }
    if (user.status === 'suspended') {
      throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'account_suspended', detail: 'The account is suspended' }]);
    }

    const now = this.clock.now();
    const { token: refreshToken, hash } = generateSecretToken();
    const session = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(AuthSession, {
          userId: user.id,
          tokenHash: hash,
          userAgent: attempt.userAgent,
          ipAddress: attempt.ipAddress,
          expiresAt: new Date(now.getTime() + this.config.auth.sessionTtlMs),
          revokedAt: null,
          createdAt: now,
        }),
      );
      await manager.update(User, { id: user.id }, { lastLoginAt: now });
      return created;
    });

    const access = this.accessTokens.issue(user.uuid, session.id, session.expiresAt);
    return { session, accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken };
  }

  /**
   * Replaces the refresh token of a session with a new one and issues a new
   * access token. The replacement only applies while the session still holds
   * the presented token, so of two refreshes with the same token only one
   * succeeds, and a token already replaced never works again. The absolute
   * deadline of the session stays.
   */
  async refresh(refreshToken: string): Promise<NewSession> {
    const invalid = new JsonApiException(HttpStatus.UNAUTHORIZED, [
      { code: 'invalid_refresh_token', detail: 'The refresh token is not valid or the session has ended' },
    ]);
    const presentedHash = hashSecretToken(refreshToken);
    const session = await this.dataSource.getRepository(AuthSession).findOneBy({ tokenHash: presentedHash });
    const user = session && (await this.dataSource.getRepository(User).findOneBy({ id: session.userId }));
    if (!session || !user || session.revokedAt || session.expiresAt <= this.clock.now() || user.status !== 'active') {
      throw invalid;
    }

    const { token, hash } = generateSecretToken();
    const { affected } = await this.dataSource
      .getRepository(AuthSession)
      .update({ id: session.id, tokenHash: presentedHash, revokedAt: IsNull() }, { tokenHash: hash });
    if (affected !== 1) throw invalid;

    const access = this.accessTokens.issue(user.uuid, session.id, session.expiresAt);
    return {
      session: { ...session, tokenHash: hash },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: token,
    };
  }

  /**
   * Resolves an access token to its account and session, rereading both: a
   * revoked or expired session, or an account that is no longer active, does not
   * authenticate even while the token itself is unexpired.
   */
  async authenticate(accessToken: string): Promise<Authentication | undefined> {
    const claims = this.accessTokens.verify(accessToken);
    if (!claims) return undefined;

    const session = await this.dataSource.getRepository(AuthSession).findOneBy({ id: claims.sid });
    const user = session && (await this.dataSource.getRepository(User).findOneBy({ id: session.userId }));
    if (!session || !user || user.uuid !== claims.sub) return undefined;
    if (session.revokedAt || session.expiresAt <= this.clock.now() || user.status !== 'active') return undefined;
    return { user, session };
  }

  /** One page of the account's open sessions: neither revoked nor past their deadline. */
  async listOpen(user: User, query: CollectionQuery): Promise<{ sessions: AuthSession[]; total: number }> {
    const [sessions, total] = await this.dataSource.getRepository(AuthSession).findAndCount({
      where: { userId: user.id, revokedAt: IsNull(), expiresAt: MoreThan(this.clock.now()) },
      order: Object.fromEntries(query.sort.map(({ field, direction }) => [field, direction])),
      ...pageWindow(query),
    });
    return { sessions, total };
  }

  /** Revokes an open session of the account; any other session, including another account's, is not found. */
  async revokeOwn(user: User, sessionId: number): Promise<void> {
    const { affected } = await this.dataSource
      .getRepository(AuthSession)
      .update(
        { id: sessionId, userId: user.id, revokedAt: IsNull(), expiresAt: MoreThan(this.clock.now()) },
        { revokedAt: this.clock.now() },
      );
    if (affected !== 1) {
      throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'session_not_found', detail: 'The session does not exist' }]);
    }
  }

  async logout(session: AuthSession): Promise<void> {
    await this.dataSource
      .getRepository(AuthSession)
      .update({ id: session.id, revokedAt: IsNull() }, { revokedAt: this.clock.now() });
  }
}
