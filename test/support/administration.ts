import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootstrapAdministrator } from '../../src/accounts/role-changes';
import { accessTokenFor, register, sendJsonApi, verifyEmail } from './accounts';
import { JSON_API } from './json-api';
import { TestApp } from './test-app';

export interface Account {
  uuid: string;
  username: string;
  accessToken: string;
}

/** Registers an account named `username`, verifies its email and logs it in. */
export async function registerVerified(app: TestApp, username: string): Promise<Account> {
  const email = `${username}@example.com`;
  const response = await register(app.server, { username, email }).expect(201);
  await verifyEmail(app.server, app.mailer.lastToken(email, 'email-verification')).expect(204);
  return { uuid: response.body.data.id, username, accessToken: await accessTokenFor(app.server, username) };
}

/** Promotes the first administrator as `pnpm admin:bootstrap` does, without spawning the command. */
export async function bootstrapAdmin(app: TestApp, username: string): Promise<void> {
  await app.app
    .get(DataSource)
    .transaction((manager) => bootstrapAdministrator(manager, username, 'Primer administrador de la prueba', app.clock.now()));
}

/** A verified account promoted as the first administrator. */
export async function registerFirstAdmin(app: TestApp, username = 'admin'): Promise<Account> {
  const account = await registerVerified(app, username);
  await bootstrapAdmin(app, username);
  return account;
}

/** POST /v1/admin/users/{id}/role-changes */
export function changeRole(app: TestApp, accessToken: string, userId: string, attributes: object) {
  return sendJsonApi(app.server, 'post', `/v1/admin/users/${userId}/role-changes`, {
    data: { type: 'role-changes', attributes },
  }).set('Authorization', `Bearer ${accessToken}`);
}

/** GET /v1/admin/users/{id}/role-changes */
export function listRoleChanges(app: TestApp, accessToken: string, userId: string) {
  return request(app.server)
    .get(`/v1/admin/users/${userId}/role-changes`)
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`);
}

/** POST /v1/admin/users/{id}/status-changes */
export function changeStatus(app: TestApp, accessToken: string, userId: string, attributes: object) {
  return sendJsonApi(app.server, 'post', `/v1/admin/users/${userId}/status-changes`, {
    data: { type: 'status-changes', attributes },
  }).set('Authorization', `Bearer ${accessToken}`);
}

/** GET /v1/admin/users/{id}/status-changes */
export function listStatusChanges(app: TestApp, accessToken: string, userId: string) {
  return request(app.server)
    .get(`/v1/admin/users/${userId}/status-changes`)
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`);
}

/** GET /v1/admin/users */
export function listAccounts(app: TestApp, accessToken: string) {
  return request(app.server).get('/v1/admin/users').set('Accept', JSON_API).set('Authorization', `Bearer ${accessToken}`);
}

/** GET /v1/admin/users/{id} */
export function getAccount(app: TestApp, accessToken: string, userId: string) {
  return request(app.server)
    .get(`/v1/admin/users/${userId}`)
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`);
}
