import { randomUUID } from 'node:crypto';
import { EntityManager, IsNull } from 'typeorm';
import { conflict, keepAnOperationalAdministrator, lockAdministeredAccount } from './administration';
import { AuthSession } from './entities/auth-session.entity';
import { UserCredential } from './entities/user-credential.entity';
import { UserStatusChange } from './entities/user-status-change.entity';
import { UserToken } from './entities/user-token.entity';
import { User, UserStatus } from './entities/user.entity';

/*
 * Suspensions, reactivations and deletions of suspended accounts by an
 * administrator (ADR 0002). Each is audited in the transaction that changes
 * `users.status`, serialized by the administration lock with role changes.
 */

export interface StatusChangeRequest {
  /** `users.id` of the administrator making the change. */
  actorId: number;
  /** `users.uuid` of the affected account. */
  userUuid: string;
  newStatus: UserStatus;
  reason: string;
  now: Date;
}

/**
 * Changes the status of an account on behalf of an administrator, comparing with
 * the status the account has under lock. A suspension ends every session at
 * once and has no end of its own; only a suspended account can be deleted this
 * way, at its holder's request; `deleted` is terminal. Neither a suspension nor
 * a deletion may take away the last operational administrator.
 */
export async function changeStatus(manager: EntityManager, request: StatusChangeRequest): Promise<UserStatusChange> {
  const { actor, user } = await lockAdministeredAccount(manager, request.actorId, request.userUuid);
  if (user.status === request.newStatus) {
    throw conflict('status_unchanged', `The account is already ${user.status}`);
  }
  if (request.newStatus === 'deleted' && user.status !== 'suspended') {
    throw conflict('account_not_suspended', 'An administrator can only delete a suspended account');
  }
  if (request.newStatus !== 'active') {
    await keepAnOperationalAdministrator(
      manager,
      user,
      'The last active administrator with a verified email cannot be suspended or deleted',
    );
  }

  if (request.newStatus === 'deleted') {
    await scrubDeletedAccount(manager, user, request.now);
  } else {
    await manager.update(User, { id: user.id }, { status: request.newStatus, updatedAt: request.now });
    if (request.newStatus === 'suspended') await revokeSessions(manager, user, request.now);
  }

  const change = manager.create(UserStatusChange, {
    id: randomUUID(),
    userId: user.id,
    changedById: actor.id,
    previousStatus: user.status,
    newStatus: request.newStatus,
    reason: request.reason,
    changedAt: request.now,
  });
  await manager.insert(UserStatusChange, change);
  return { ...change, user: { ...user, status: request.newStatus }, changedBy: actor };
}

/**
 * Marks the account deleted and removes its personal data: the email, freed for
 * a new account, the avatar, the bio and the password (social identities, out of
 * the MVP, have no table yet). The username stays reserved and becomes the
 * display name. Sessions and pending tokens end.
 */
async function scrubDeletedAccount(manager: EntityManager, user: User, now: Date): Promise<void> {
  await manager.update(
    User,
    { id: user.id },
    { status: 'deleted', email: null, avatarUrl: null, bio: null, displayName: user.username, updatedAt: now },
  );
  await manager.delete(UserCredential, { userId: user.id });
  await manager.update(UserToken, { userId: user.id, usedAt: IsNull() }, { usedAt: now });
  await revokeSessions(manager, user, now);
}

async function revokeSessions(manager: EntityManager, user: User, now: Date): Promise<void> {
  await manager.update(AuthSession, { userId: user.id, revokedAt: IsNull() }, { revokedAt: now });
}
