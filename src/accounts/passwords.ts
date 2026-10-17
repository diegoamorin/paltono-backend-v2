import { hash, verify } from '@node-rs/argon2';

// The library defaults are Argon2id with the OWASP-recommended cost (m=19 MiB, t=2, p=1).

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
