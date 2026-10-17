import { HttpStatus } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { EntityManager } from 'typeorm';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { UserCredential } from './entities/user-credential.entity';

// The library defaults are Argon2id with the OWASP-recommended cost (m=19 MiB, t=2, p=1).

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

/**
 * Requires the password of an account, locking its credential until the
 * transaction ends; a wrong one is a 422 on the attribute that carried it.
 */
export async function requirePassword(
  manager: EntityManager,
  userId: number,
  password: string,
  attribute: string,
): Promise<UserCredential> {
  const credential = await manager.findOne(UserCredential, { where: { userId }, lock: { mode: 'pessimistic_write' } });
  if (!credential || !(await verifyPassword(credential.passwordHash, password))) {
    throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [
      { code: 'password_incorrect', detail: 'The password is incorrect', source: { pointer: `/data/attributes/${attribute}` } },
    ]);
  }
  return credential;
}
