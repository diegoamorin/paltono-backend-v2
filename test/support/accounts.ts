import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JSON_API } from './json-api';

export interface Registration {
  username: string;
  email: string;
  password: string;
  displayName: string;
  frontend?: string;
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
export function requestVerification(server: App, accessToken: string, frontend?: string) {
  return sendJsonApi(server, 'post', '/v1/email-verification-requests', {
    data: { type: 'email-verification-requests', attributes: frontend ? { frontend } : {} },
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
 * Sets an account's status straight in the database, standing in for the
 * administration endpoints (suspension, deletion) until they exist.
 */
export async function setAccountStatus(dataSource: DataSource, username: string, status: 'suspended' | 'deleted') {
  // A deleted account loses its email, as the deletion scrub requires.
  await dataSource.query(
    `UPDATE users SET status = $2::user_status, email = CASE WHEN $2 = 'deleted' THEN NULL ELSE email END
     WHERE username = $1`,
    [username, status],
  );
}
