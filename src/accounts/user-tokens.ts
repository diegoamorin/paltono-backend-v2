import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { User } from './entities/user.entity';
import { UserToken, UserTokenPurpose } from './entities/user-token.entity';
import { generateSecretToken, hashSecretToken } from './secret-tokens';

export interface IssuedUserToken {
  /** Goes in the emailed link; never stored. */
  token: string;
  /** Identifies the send request, for the idempotency key of the email. */
  tokenId: number;
}

/**
 * Stores a new one-time token of an account for a purpose, valid for `ttlMs`.
 * An email change token is bound to its destination, `targetEmail`, normalized
 * to lowercase.
 */
export async function issueUserToken(
  manager: EntityManager,
  user: User,
  purpose: Exclude<UserTokenPurpose, 'email_change'>,
  ttlMs: number,
  now: Date,
): Promise<IssuedUserToken>;
export async function issueUserToken(
  manager: EntityManager,
  user: User,
  purpose: 'email_change',
  ttlMs: number,
  now: Date,
  targetEmail: string,
): Promise<IssuedUserToken>;
export async function issueUserToken(
  manager: EntityManager,
  user: User,
  purpose: UserTokenPurpose,
  ttlMs: number,
  now: Date,
  targetEmail?: string,
): Promise<IssuedUserToken> {
  const { token, hash } = generateSecretToken();
  const { identifiers } = await manager.insert(UserToken, {
    userId: user.id,
    purpose,
    targetEmail: targetEmail?.toLowerCase() ?? null,
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + ttlMs),
    createdAt: now,
  });
  return { token, tokenId: identifiers[0].id };
}

/**
 * Finds a one-time token of a purpose and its account, locking both until the
 * transaction ends so a token is consumed once however many requests race for
 * it. Refuses unknown tokens and deleted accounts (422) and used or expired
 * tokens (409); the caller then consumes the token.
 */
export async function claimUserToken(
  manager: EntityManager,
  token: string,
  purpose: UserTokenPurpose,
  now: Date,
): Promise<{ stored: UserToken; user: User }> {
  const stored = await manager.findOne(UserToken, {
    where: { tokenHash: hashSecretToken(token), purpose },
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
  return { stored, user };
}

function tokenStateError(code: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.CONFLICT, [{ code, detail, source: { pointer: '/data/attributes/token' } }]);
}
