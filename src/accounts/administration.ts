import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { User } from './entities/user.entity';

/*
 * Rules shared by every change an administrator makes to an account: role
 * changes, status changes and the console bootstrap (ADR 0003). They run inside
 * a caller's transaction and take the administration lock first, so they are
 * serialized with each other and none of them can leave the system without an
 * operational administrator.
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
 * Starts a change an administrator makes to another account: takes the
 * administration lock, requires the actor to still be an operational
 * administrator and locks the affected account, which must not be deleted.
 */
export async function lockAdministeredAccount(
  manager: EntityManager,
  actorId: number,
  userUuid: string,
): Promise<{ actor: User; user: User }> {
  await lockAdministration(manager);
  const actor = await requireOperationalAdministrator(manager, actorId);
  const user = await manager.findOne(User, { where: { uuid: userUuid }, lock: { mode: 'pessimistic_write' } });
  if (!user) throw accountNotFound();
  if (user.status === 'deleted') throw conflict('account_deleted', 'The account is deleted');
  return { actor, user };
}

/** Rereads the acting account under the administration lock and requires it to still be an operational administrator. */
async function requireOperationalAdministrator(manager: EntityManager, actorId: number): Promise<User> {
  const actor = await manager.findOneBy(User, { id: actorId });
  if (!actor || !isOperationalAdministrator(actor)) {
    throw new JsonApiException(HttpStatus.FORBIDDEN, [
      { code: 'administrator_required', detail: 'Only an administrator can do this' },
    ]);
  }
  return actor;
}

/**
 * Refuses a change that would take away the last operational administrator,
 * when `user` is one. Call it under the administration lock.
 */
export async function keepAnOperationalAdministrator(manager: EntityManager, user: User, detail: string): Promise<void> {
  if (!isOperationalAdministrator(user)) return;
  const others = await manager
    .createQueryBuilder(User, 'user')
    .where(`user.role = 'admin' AND user.status = 'active' AND user.email_verified`)
    .andWhere('user.id <> :id', { id: user.id })
    .getCount();
  if (others === 0) throw conflict('last_administrator', detail);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account ids are `users.uuid`; anything else names no account. */
export function accountId(id: string): string {
  if (!UUID.test(id)) throw accountNotFound();
  return id;
}

export function accountNotFound(): JsonApiException {
  return new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'account_not_found', detail: 'The account does not exist' }]);
}

export function conflict(code: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.CONFLICT, [{ code, detail }]);
}
