/*
 * Account rules from ADR 0002, shared by validation and the services.
 */

/** Lowercase ASCII letters, digits, `_` and `.`, 1 to 30 characters, no trailing period. */
export const USERNAME_PATTERN = /^[a-z0-9_.]{0,29}[a-z0-9_]$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** A username may change once this much time has passed since it was last assigned. */
export const USERNAME_CHANGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeUsername(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}
