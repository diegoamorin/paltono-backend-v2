import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { JsonApiErrorInput, JsonApiException } from '../common/json-api/json-api.exception';

/*
 * Who may see and change editorial records. Drafts and reservations are private
 * to their author, even before staff: anyone else gets the same 404 as for a
 * record that does not exist.
 */

/** Moderators and administrators that can act: active, with a verified email. */
export function isStaff(user: User | undefined): boolean {
  return !!user && (user.role === 'moderator' || user.role === 'admin') && user.status === 'active' && user.emailVerified;
}

/**
 * Rereads the acting account inside a write's transaction and requires it to
 * still be able to contribute. The share lock holds back a concurrent
 * suspension until the write commits.
 */
export async function lockContributor(manager: EntityManager, userId: number): Promise<User> {
  const user = await manager.findOne(User, { where: { id: userId }, lock: { mode: 'pessimistic_read' } });
  if (!user || user.status !== 'active') {
    throw new JsonApiException(HttpStatus.UNAUTHORIZED, [{ code: 'unauthenticated', detail: 'The account can no longer act' }]);
  }
  if (!user.emailVerified) {
    throw new JsonApiException(HttpStatus.FORBIDDEN, [{ code: 'email_not_verified', detail: 'Verify your email before doing this' }]);
  }
  return user;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Editorial ids are UUIDs; anything else names nothing, with the given not-found error. */
export function editorialId(id: string, notFound: () => JsonApiException): string {
  if (!UUID.test(id)) throw notFound();
  return id.toLowerCase();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export const entityNotFound = () => notFound('editorial_entity_not_found', 'The editorial entity does not exist');
export const proposalNotFound = () => notFound('proposal_not_found', 'The proposal does not exist');
export const changeNotFound = () => notFound('proposal_change_not_found', 'The microchange does not exist in this proposal');
export const sourceNotFound = () => notFound('proposal_source_not_found', 'The source does not exist in this proposal');

function notFound(code: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.NOT_FOUND, [{ code, detail }]);
}

/** A PATCH body names the resource of its URL. */
export function requireMatchingId(bodyId: string, urlId: string): void {
  if (bodyId.toLowerCase() !== urlId) {
    throw new JsonApiException(HttpStatus.CONFLICT, [
      { code: 'id_mismatch', detail: 'data.id must match the id in the URL', source: { pointer: '/data/id' } },
    ]);
  }
}

export function invalid(errors: JsonApiErrorInput[]): JsonApiException {
  return new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, errors);
}
