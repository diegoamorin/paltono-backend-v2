import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Clock } from '../common/clock/clock';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface AccessTokenClaims {
  /** `users.uuid`. */
  sub: string;
  /** `auth_sessions.id`. */
  sid: number;
  /** Seconds since the epoch, as in JWT. */
  iat: number;
  exp: number;
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Short-lived access tokens: JWTs signed with HS256. Expiry is checked against
 * the injected clock. A valid token only names a session; callers still check
 * that the session and account can act.
 */
@Injectable()
export class AccessTokens {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  issue(userUuid: string, sessionId: number, sessionExpiresAt: Date): { token: string; expiresAt: Date } {
    const now = this.clock.now().getTime();
    const expiresAt = new Date(Math.min(now + this.config.auth.accessTokenTtlMs, sessionExpiresAt.getTime()));
    const claims: AccessTokenClaims = {
      sub: userUuid,
      sid: sessionId,
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const unsigned = `${HEADER}.${base64url(JSON.stringify(claims))}`;
    return { token: `${unsigned}.${this.sign(unsigned)}`, expiresAt };
  }

  /** The claims of a well-signed, unexpired token; `undefined` for anything else. */
  verify(token: string): AccessTokenClaims | undefined {
    const [header, payload, signature, ...rest] = token.split('.');
    if (rest.length > 0 || header !== HEADER || !payload || !signature) return undefined;

    const expected = Buffer.from(this.sign(`${header}.${payload}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;

    const claims = parseClaims(payload);
    if (!claims || claims.exp * 1000 <= this.clock.now().getTime()) return undefined;
    return claims;
  }

  private sign(unsigned: string): string {
    return createHmac('sha256', this.config.auth.accessTokenSecret).update(unsigned).digest('base64url');
  }
}

function parseClaims(payload: string): AccessTokenClaims | undefined {
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const valid =
      typeof claims.sub === 'string' &&
      Number.isSafeInteger(claims.sid) &&
      Number.isSafeInteger(claims.iat) &&
      Number.isSafeInteger(claims.exp);
    return valid ? claims : undefined;
  } catch {
    return undefined;
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
