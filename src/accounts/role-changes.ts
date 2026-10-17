import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { UserRoleChange } from './entities/user-role-change.entity';
import { User, UserRole } from './entities/user.entity';

/*
 * Role changes and the console bootstrap of the first administrator (ADR 0003).
 * Both run inside a caller's transaction and take the administration lock
 * first, so they are serialized with each other and with every other path that
 * can leave the system without an operational administrator.
 */

/** Key of the transaction-level advisory lock that serializes administration changes. */
const ADMINISTRATION_LOCK_KEY = 4_271_003;

/**
 * Serializes, until the transaction ends, every change that can add or remove an
 * operational administrator: an active admin with a verified email. Take it
 * before locking any account row.
 */
export async function lockAdministration(manager: EntityManager): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock($1)', [ADMINISTRATION_LOCK_KEY]);
}

/** Whether the account is an administrator that can act: active and with a verified email. */
export function isOperationalAdministrator(user: User): boolean {
  return user.role === 'admin' && user.status === 'active' && user.emailVerified;
}

/**
 * Promotes an active, verified account to administrator while no administrator
 * exists, auditing it with no acting administrator. Console only.
 */
export async function bootstrapAdministrator(
  manager: EntityManager,
  username: string,
  reason: string,
  now: Date,
): Promise<User> {
  if (reason.trim() === '') {
    throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [{ code: 'reason_required', detail: 'A reason is required' }]);
  }
  await lockAdministration(manager);

  if (await manager.existsBy(User, { role: 'admin' })) {
    throw conflict('administrator_exists', 'An administrator already exists; ask one to change roles instead');
  }
  const user = await manager.findOne(User, {
    where: { username: username.toLowerCase() },
    lock: { mode: 'pessimistic_write' },
  });
  if (!user) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ detail: `No account has the username "${username}"` }]);
  if (user.status !== 'active') throw conflict('account_not_active', `The account must be active; it is ${user.status}`);
  if (!user.emailVerified) throw conflict('email_not_verified', 'The account must have a verified email');

  await recordRoleChange(manager, user, 'admin', null, reason.trim(), now);
  return { ...user, role: 'admin' };
}

export interface RoleChangeRequest {
  /** `users.id` of the administrator making the change. */
  actorId: number;
  /** `users.uuid` of the affected account. */
  userUuid: string;
  newRole: UserRole;
  reason: string;
  now: Date;
}

/**
 * Changes the role of an account on behalf of an administrator, comparing with
 * the role the account has under lock, and refusing to demote the last
 * operational administrator.
 */
export async function changeRole(manager: EntityManager, request: RoleChangeRequest): Promise<UserRoleChange> {
  await lockAdministration(manager);

  const actor = await manager.findOneBy(User, { id: request.actorId });
  if (!actor || !isOperationalAdministrator(actor)) {
    throw new JsonApiException(HttpStatus.FORBIDDEN, [
      { code: 'administrator_required', detail: 'Only an administrator can do this' },
    ]);
  }
  const user = await manager.findOne(User, { where: { uuid: request.userUuid }, lock: { mode: 'pessimistic_write' } });
  if (!user) throw accountNotFound();
  if (user.status === 'deleted') throw conflict('account_deleted', 'The account is deleted');
  if (user.role === request.newRole) throw conflict('role_unchanged', `The account already has the role ${user.role}`);

  if (isOperationalAdministrator(user)) {
    const others = await manager
      .createQueryBuilder(User, 'user')
      .where(`user.role = 'admin' AND user.status = 'active' AND user.email_verified`)
      .andWhere('user.id <> :id', { id: user.id })
      .getCount();
    if (others === 0) {
      throw conflict('last_administrator', 'The last active administrator with a verified email cannot be demoted');
    }
  }

  const change = await recordRoleChange(manager, user, request.newRole, actor.id, request.reason, request.now);
  return { ...change, user: { ...user, role: request.newRole }, changedBy: actor };
}

export function accountNotFound(): JsonApiException {
  return new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'account_not_found', detail: 'The account does not exist' }]);
}

/** Updates the role and appends its audit row, in the caller's transaction. */
async function recordRoleChange(
  manager: EntityManager,
  user: User,
  newRole: UserRole,
  changedById: number | null,
  reason: string,
  now: Date,
): Promise<UserRoleChange> {
  await manager.update(User, { id: user.id }, { role: newRole, updatedAt: now });
  const change = manager.create(UserRoleChange, {
    id: randomUUID(),
    userId: user.id,
    changedById,
    previousRole: user.role,
    newRole,
    reason,
    changedAt: now,
  });
  await manager.insert(UserRoleChange, change);
  return change;
}

function conflict(code: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.CONFLICT, [{ code, detail }]);
}
