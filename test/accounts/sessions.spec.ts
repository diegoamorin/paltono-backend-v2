import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  DEFAULT_PASSWORD,
  accessTokenFor,
  getMe,
  login,
  logout,
  register,
  requestVerification,
  sendJsonApi,
  setAccountStatus,
  verifyEmail,
} from '../support/accounts';
import { ContributionsFixtureModule } from '../support/contributions-fixture';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('sessions', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ContributionsFixtureModule] });
  });

  beforeEach(async () => {
    await app.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  const contribute = (accessToken: string) =>
    sendJsonApi(app.server, 'post', '/v1/contribution-probes').set('Authorization', `Bearer ${accessToken}`);

  describe('POST /v1/sessions (login)', () => {
    it.each([
      ['username', 'diego_papi'],
      ['username in another case', 'Diego_Papi'],
      ['email', 'diego@example.com'],
      ['email in another case', 'DIEGO@example.com'],
    ])('accepts the %s', async (_, identifier) => {
      await register(app.server).expect(201);

      const response = await login(app.server, { identifier }).set('User-Agent', 'PaltonoTest/1.0').expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'sessions',
          id: expect.stringMatching(/^\d+$/),
          attributes: {
            userAgent: 'PaltonoTest/1.0',
            ipAddress: expect.any(String),
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-31T00:00:00.000Z',
          },
        },
        links: { self: '/v1/sessions/current' },
        meta: {
          accessToken: expect.any(String),
          accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
          refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      });
    });

    it('gives a mobile client the refresh token in the body and no cookie', async () => {
      await register(app.server).expect(201);

      const response = await login(app.server, { identifier: 'diego_papi', client: 'mobile' }).expect(201);

      expect(response.body.meta.refreshToken).toEqual(expect.any(String));
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('gives a web client the refresh token in a secure cookie only', async () => {
      await register(app.server).expect(201);

      const response = await login(app.server, { identifier: 'diego_papi', client: 'web' }).expect(201);

      expect(response.body.meta).not.toHaveProperty('refreshToken');
      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^paltono_refresh_token=[A-Za-z0-9_-]{43};/);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; Secure/);
      expect(cookie).toMatch(/; SameSite=Lax/);
      expect(cookie).toMatch(/; Path=\/v1/);
      expect(cookie).toMatch(/; Expires=Sat, 31 Jan 2026 00:00:00 GMT/);
    });

    it('lets an unverified account log in', async () => {
      await register(app.server).expect(201);

      await login(app.server, { identifier: 'diego_papi' }).expect(201);
    });

    it('answers a wrong password and an unknown account the same way', async () => {
      await register(app.server).expect(201);

      const wrongPassword = await login(app.server, { identifier: 'diego_papi', password: 'wrong password' }).expect(401);
      const unknownAccount = await login(app.server, { identifier: 'nobody' }).expect(401);

      expect(wrongPassword.body).toEqual(unknownAccount.body);
      expect(wrongPassword.body.errors).toEqual([expect.objectContaining({ status: '401', code: 'invalid_credentials' })]);
    });

    it('tells a suspended account it is suspended only after the right password', async () => {
      await register(app.server).expect(201);
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');

      const right = await login(app.server, { identifier: 'diego_papi' }).expect(403);
      const wrong = await login(app.server, { identifier: 'diego_papi', password: 'wrong password' }).expect(401);

      expect(right.body.errors).toEqual([expect.objectContaining({ status: '403', code: 'account_suspended' })]);
      expect(wrong.body.errors).toEqual([expect.objectContaining({ code: 'invalid_credentials' })]);
    });

    it('does not let a deleted account log in, even by its reserved username', async () => {
      await register(app.server).expect(201);
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'deleted');

      const response = await login(app.server, { identifier: 'diego_papi' }).expect(401);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'invalid_credentials' })]);
    });

    it('validates the body', async () => {
      const response = await sendJsonApi(app.server, 'post', '/v1/sessions', {
        data: { type: 'sessions', attributes: { identifier: '', password: DEFAULT_PASSWORD, client: 'desktop' } },
      }).expect(422);

      const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
      expect([...new Set(pointers)].sort()).toEqual(['/data/attributes/client', '/data/attributes/identifier']);
    });

    it('rejects query parameters it does not support', async () => {
      await register(app.server).expect(201);

      await login(app.server, { identifier: 'diego_papi' }).query({ sort: 'createdAt' }).expect(400);
    });

    it('takes its lifetimes from the configuration', async () => {
      const configured = await createTestApp({ env: { ACCESS_TOKEN_TTL_SECONDS: '60', SESSION_TTL_DAYS: '7' } });
      try {
        await configured.reset();
        await register(configured.server).expect(201);

        const response = await login(configured.server, { identifier: 'diego_papi' }).expect(201);

        expect(response.body.meta.accessTokenExpiresAt).toBe('2026-01-01T00:01:00.000Z');
        expect(response.body.data.attributes.expiresAt).toBe('2026-01-08T00:00:00.000Z');
      } finally {
        await configured.close();
      }
    });

    it('requires the JSON:API media type', async () => {
      await request(app.server)
        .post('/v1/sessions')
        .set('Content-Type', 'application/json')
        .send({ data: { type: 'sessions', attributes: { identifier: 'diego_papi', password: DEFAULT_PASSWORD, client: 'web' } } })
        .expect(415);
    });
  });

  describe('GET /v1/me', () => {
    it('shows the own account, unverified included', async () => {
      const registered = await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await getMe(app.server, accessToken).expect(200);

      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: registered.body.data,
        links: { self: '/v1/me' },
      });
    });

    it('supports sparse fieldsets', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await getMe(app.server, accessToken).query({ 'fields[users]': 'username,emailVerified' }).expect(200);

      expect(response.body.data.attributes).toEqual({ username: 'diego_papi', emailVerified: false });
    });

    it('requires an access token', async () => {
      const response = await request(app.server).get('/v1/me').set('Accept', JSON_API).expect(401);

      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body.errors).toEqual([expect.objectContaining({ status: '401', code: 'unauthenticated' })]);
    });

    it('rejects a malformed or tampered access token', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');
      const [header, payload, signature] = accessToken.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, sid: claims.sid + 1 })).toString('base64url');

      await getMe(app.server, 'not-a-token').expect(401);
      await getMe(app.server, `${header}.${forged}.${signature}`).expect(401);
      await request(app.server).get('/v1/me').set('Accept', JSON_API).set('Authorization', `Basic ${accessToken}`).expect(401);
    });

    it('stops accepting an access token after 15 minutes', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      app.clock.advance(15 * MINUTE - 1000);
      await getMe(app.server, accessToken).expect(200);
      app.clock.advance(1000);
      await getMe(app.server, accessToken).expect(401);
    });

    it('stops authorizing an unexpired access token once the account is suspended or deleted', async () => {
      await register(app.server).expect(201);
      await register(app.server, { username: 'other', email: 'other@example.com' }).expect(201);
      const suspended = await accessTokenFor(app.server, 'diego_papi');
      const deleted = await accessTokenFor(app.server, 'other');

      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');
      await setAccountStatus(app.app.get(DataSource), 'other', 'deleted');

      await getMe(app.server, suspended).expect(401);
      await getMe(app.server, deleted).expect(401);
    });
  });

  describe('DELETE /v1/sessions/current (logout)', () => {
    it('revokes the session, so its unexpired access token stops working', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await logout(app.server, accessToken).expect(204);

      expect(response.text).toBe('');
      await getMe(app.server, accessToken).expect(401);
      await logout(app.server, accessToken).expect(401);
    });

    it('clears the refresh token cookie', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await logout(app.server, accessToken).expect(204);

      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^paltono_refresh_token=;/);
      expect(cookie).toMatch(/; Path=\/v1/);
      expect(cookie).toMatch(/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    });

    it('leaves the other sessions of the account open', async () => {
      await register(app.server).expect(201);
      const phone = await accessTokenFor(app.server, 'diego_papi');
      const laptop = await accessTokenFor(app.server, 'diego_papi');

      await logout(app.server, phone).expect(204);

      await getMe(app.server, laptop).expect(200);
    });

    it('requires an access token', async () => {
      await sendJsonApi(app.server, 'delete', '/v1/sessions/current').expect(401);
    });
  });

  describe('an unverified account', () => {
    it('can see its account, ask for the verification email again and log out, but not contribute', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      await getMe(app.server, accessToken).expect(200);
      await requestVerification(app.server, accessToken).expect(202);
      const response = await contribute(accessToken).expect(403);
      expect(response.body.errors).toEqual([expect.objectContaining({ status: '403', code: 'email_not_verified' })]);
      await logout(app.server, accessToken).expect(204);
    });

    it('can contribute with the same session once verified', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');
      await contribute(accessToken).expect(403);

      await verifyEmail(app.server, app.mailer.lastToken('diego@example.com', 'email-verification')).expect(204);

      await contribute(accessToken).expect(204);
    });
  });
});
