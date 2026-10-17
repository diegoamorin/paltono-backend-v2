import { createHash, randomBytes } from 'node:crypto';

export interface SecretToken {
  /** Handed to the client once; never stored. */
  token: string;
  /** Stored instead of the token. */
  hash: string;
}

/** A random 256-bit token, URL safe, with the hash to store. */
export function generateSecretToken(): SecretToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSecretToken(token) };
}

/** SHA-256 suffices: the tokens are random, so there is nothing to brute-force. */
export function hashSecretToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
