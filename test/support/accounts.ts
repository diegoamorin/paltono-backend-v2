import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JSON_API } from './json-api';

export interface Registration {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export const DEFAULT_PASSWORD = 'correct horse battery staple';

export function registration(overrides: Partial<Registration> = {}): Registration {
  return {
    username: 'diego_papi',
    email: 'diego@example.com',
    password: DEFAULT_PASSWORD,
    displayName: 'Diego 🎤',
    ...overrides,
  };
}

/** Sends a JSON:API request with a JSON body. */
export function sendJsonApi(server: App, method: 'post' | 'patch' | 'delete', path: string, body?: object) {
  const pending = request(server)[method](path).set('Accept', JSON_API);
  return body === undefined ? pending : pending.set('Content-Type', JSON_API).send(JSON.stringify(body));
}

/** POST /v1/users */
export function register(server: App, overrides: Partial<Registration> = {}) {
  return sendJsonApi(server, 'post', '/v1/users', { data: { type: 'users', attributes: registration(overrides) } });
}

/** POST /v1/email-verifications */
export function verifyEmail(server: App, token: string) {
  return sendJsonApi(server, 'post', '/v1/email-verifications', {
    data: { type: 'email-verifications', attributes: { token } },
  });
}

/** POST /v1/email-verification-requests */
export function requestVerification(server: App, accessToken: string) {
  return sendJsonApi(server, 'post', '/v1/email-verification-requests', {
    data: { type: 'email-verification-requests', attributes: {} },
  }).set('Authorization', `Bearer ${accessToken}`);
}

export interface Credentials {
  identifier: string;
  password?: string;
  client?: 'web' | 'mobile';
}

/** POST /v1/sessions */
export function login(server: App, { identifier, password = DEFAULT_PASSWORD, client = 'mobile' }: Credentials) {
  return sendJsonApi(server, 'post', '/v1/sessions', {
    data: { type: 'sessions', attributes: { identifier, password, client } },
  });
}

/** Logs in and returns the access token. */
export async function accessTokenFor(server: App, identifier: string, password = DEFAULT_PASSWORD): Promise<string> {
  const response = await login(server, { identifier, password }).expect(201);
  return response.body.meta.accessToken;
}

/** GET /v1/me */
export function getMe(server: App, accessToken: string) {
  return request(server).get('/v1/me').set('Accept', JSON_API).set('Authorization', `Bearer ${accessToken}`);
}

/** DELETE /v1/sessions/current */
export function logout(server: App, accessToken: string) {
  return sendJsonApi(server, 'delete', '/v1/sessions/current').set('Authorization', `Bearer ${accessToken}`);
}

/**
 * Sets an account's status straight in the database, for tests that need a
 * suspended or deleted account without an administrator to change it, or
 * without the audit and side effects of a status change.
 */
export async function setAccountStatus(dataSource: DataSource, username: string, status: 'suspended' | 'deleted') {
  // A deleted account loses its email, as the deletion scrub requires.
  await dataSource.query(
    `UPDATE users SET status = $2::user_status, email = CASE WHEN $2 = 'deleted' THEN NULL ELSE email END
     WHERE username = $1`,
    [username, status],
  );
}

export interface RefreshCredentials {
  /** Sent in the body, as mobile clients do. */
  refreshToken?: string;
  /** A `Set-Cookie` or `Cookie` value to send back, as browsers do. */
  cookie?: string;
}

/** POST /v1/session-refreshes */
export function refreshSession(server: App, { refreshToken, cookie }: RefreshCredentials) {
  const pending = sendJsonApi(server, 'post', '/v1/session-refreshes', {
    data: { type: 'session-refreshes', attributes: refreshToken === undefined ? {} : { refreshToken } },
  });
  return cookie === undefined ? pending : pending.set('Cookie', cookie.split(';')[0]);
}

/** GET /v1/me/sessions */
export function listSessions(server: App, accessToken: string) {
  return request(server).get('/v1/me/sessions').set('Accept', JSON_API).set('Authorization', `Bearer ${accessToken}`);
}

/** DELETE /v1/me/sessions/{id} */
export function revokeSession(server: App, accessToken: string, id: string) {
  return sendJsonApi(server, 'delete', `/v1/me/sessions/${id}`).set('Authorization', `Bearer ${accessToken}`);
}

/** POST /v1/password-reset-requests */
export function requestPasswordReset(server: App, email: string) {
  return sendJsonApi(server, 'post', '/v1/password-reset-requests', {
    data: { type: 'password-reset-requests', attributes: { email } },
  });
}

/** POST /v1/password-resets */
export function resetPassword(server: App, token: string, password: string) {
  return sendJsonApi(server, 'post', '/v1/password-resets', {
    data: { type: 'password-resets', attributes: { token, password } },
  });
}

/** POST /v1/me/password-changes */
export function changePassword(server: App, accessToken: string, currentPassword: string, newPassword: string) {
  return sendJsonApi(server, 'post', '/v1/me/password-changes', {
    data: { type: 'password-changes', attributes: { currentPassword, newPassword } },
  }).set('Authorization', `Bearer ${accessToken}`);
}

/** PATCH /v1/me */
export function updateProfile(server: App, accessToken: string, id: string, attributes: object) {
  return sendJsonApi(server, 'patch', '/v1/me', { data: { type: 'users', id, attributes } }).set(
    'Authorization',
    `Bearer ${accessToken}`,
  );
}

export interface EmailChangeRequest {
  currentPassword?: string;
  newEmail: string;
}

/** POST /v1/me/email-change-requests */
export function requestEmailChange(
  server: App,
  accessToken: string,
  { currentPassword = DEFAULT_PASSWORD, ...attributes }: EmailChangeRequest,
) {
  return sendJsonApi(server, 'post', '/v1/me/email-change-requests', {
    data: { type: 'email-change-requests', attributes: { currentPassword, ...attributes } },
  }).set('Authorization', `Bearer ${accessToken}`);
}

/** POST /v1/email-changes */
export function confirmEmailChange(server: App, token: string) {
  return sendJsonApi(server, 'post', '/v1/email-changes', { data: { type: 'email-changes', attributes: { token } } });
}

/** POST /v1/account-deletions */
export function deleteAccount(server: App, accessToken: string, password = DEFAULT_PASSWORD) {
  return sendJsonApi(server, 'post', '/v1/account-deletions', {
    data: { type: 'account-deletions', attributes: { password } },
  }).set('Authorization', `Bearer ${accessToken}`);
}
