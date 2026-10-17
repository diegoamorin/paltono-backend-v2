import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import {
  conflict,
  keepAnOperationalAdministrator,
  lockAdministeredAccount,
  lockAdministration,
} from './administration';
import { UserRoleChange } from './entities/user-role-change.entity';
import { User, UserRole } from './entities/user.entity';

/*
 * Role changes and the console bootstrap of the first administrator (ADR 0003),
 * both serialized by the administration lock.
 */

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
  const { actor, user } = await lockAdministeredAccount(manager, request.actorId, request.userUuid);
  if (user.role === request.newRole) throw conflict('role_unchanged', `The account already has the role ${user.role}`);

  await keepAnOperationalAdministrator(
    manager,
    user,
    'The last active administrator with a verified email cannot be demoted',
  );

  const change = await recordRoleChange(manager, user, request.newRole, actor.id, request.reason, request.now);
  return { ...change, user: { ...user, role: request.newRole }, changedBy: actor };
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
