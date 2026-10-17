import { HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';

const UNIQUE_VIOLATION = '23505';

/** The attribute behind each unique constraint a write to an account can collide with. */
const TAKEN_BY_CONSTRAINT: Record<string, string> = {
  users_username_key: 'username',
  users_email_key: 'email',
};

/**
 * Turns a collision with another account's username or email into a 409 whose
 * pointer names `attribute`, or the colliding one when not given.
 */
export function takenError(error: unknown, attribute?: string): JsonApiException | undefined {
  if (!(error instanceof QueryFailedError)) return undefined;
  const { code, constraint } = error.driverError as { code?: string; constraint?: string };
  const taken = code === UNIQUE_VIOLATION && constraint ? TAKEN_BY_CONSTRAINT[constraint] : undefined;
  return taken ? takenConflict(taken, attribute) : undefined;
}

/** The 409 for a username or email another account holds, pointing at `attribute`, or at the taken one when not given. */
export function takenConflict(taken: string, attribute = taken): JsonApiException {
  return new JsonApiException(HttpStatus.CONFLICT, [
    { code: `${taken}_taken`, detail: `${taken} is already taken`, source: { pointer: `/data/attributes/${attribute}` } },
  ]);
}
