import request from 'supertest';
import { getMe, listSessions, login, refreshSession, register, revokeSession } from '../support/accounts';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe('own sessions', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    await register(app.server).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Logs in and returns the session id with its tokens. */
  async function openSession(identifier = 'diego_papi', userAgent = 'PaltonoTest/1.0') {
    const response = await login(app.server, { identifier }).set('User-Agent', userAgent).expect(201);
    const { accessToken, refreshToken } = response.body.meta;
    return { id: response.body.data.id as string, accessToken: accessToken as string, refreshToken: refreshToken as string };
  }

  describe('GET /v1/me/sessions', () => {
    it('lists the open sessions of the account, newest first, marking the current one', async () => {
      const phone = await openSession('diego_papi', 'Phone/1.0');
      app.clock.advance(MINUTE);
      const laptop = await openSession('diego_papi', 'Laptop/1.0');

      const response = await listSessions(app.server, phone.accessToken).expect(200);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: [
          {
            type: 'sessions',
            id: laptop.id,
            attributes: {
              userAgent: 'Laptop/1.0',
              ipAddress: expect.any(String),
              createdAt: '2026-01-01T00:01:00.000Z',
              expiresAt: '2026-01-31T00:01:00.000Z',
              current: false,
            },
          },
          {
            type: 'sessions',
            id: phone.id,
            attributes: {
              userAgent: 'Phone/1.0',
              ipAddress: expect.any(String),
              createdAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2026-01-31T00:00:00.000Z',
              current: true,
            },
          },
        ],
        links: expect.objectContaining({ self: '/v1/me/sessions?page%5Bnumber%5D=1&page%5Bsize%5D=20' }),
        meta: { total: 2 },
      });
    });

    it('leaves out sessions of other accounts, and ended sessions', async () => {
      await register(app.server, { username: 'other', email: 'other@example.com' }).expect(201);
      await openSession('other');
      const loggedOut = await openSession();
      await request(app.server)
        .delete('/v1/sessions/current')
        .set('Accept', JSON_API)
        .set('Authorization', `Bearer ${loggedOut.accessToken}`)
        .expect(204);
      const older = await openSession();
      app.clock.advance(DAY);
      const current = await openSession();

      const response = await listSessions(app.server, current.accessToken).expect(200);

      expect(response.body.data.map((session: { id: string }) => session.id)).toEqual([current.id, older.id]);
      app.clock.advance(29 * DAY);
      const refreshed = await refreshSession(app.server, { refreshToken: current.refreshToken }).expect(200);
      const later = await listSessions(app.server, refreshed.body.meta.accessToken).expect(200);
      expect(later.body.data.map((session: { id: string }) => session.id)).toEqual([current.id]);
    });

    it('supports sparse fieldsets and pagination', async () => {
      await openSession();
      const current = await openSession();

      const response = await listSessions(app.server, current.accessToken)
        .query({ 'fields[sessions]': 'current', 'page[size]': '1', sort: 'createdAt' })
        .expect(200);

      expect(response.body.data).toEqual([{ type: 'sessions', id: expect.any(String), attributes: { current: false } }]);
      expect(response.body.meta.total).toBe(2);
    });

    it('requires an access token', async () => {
      await request(app.server).get('/v1/me/sessions').set('Accept', JSON_API).expect(401);
    });
  });

  describe('DELETE /v1/me/sessions/{id}', () => {
    it('revokes another session of the account, so neither its access nor its refresh token work', async () => {
      const phone = await openSession();
      const laptop = await openSession();

      const response = await revokeSession(app.server, laptop.accessToken, phone.id).expect(204);

      expect(response.text).toBe('');
      await getMe(app.server, phone.accessToken).expect(401);
      await refreshSession(app.server, { refreshToken: phone.refreshToken }).expect(401);
      await getMe(app.server, laptop.accessToken).expect(200);
    });

    it('can revoke the current session', async () => {
      const current = await openSession();

      await revokeSession(app.server, current.accessToken, current.id).expect(204);

      await getMe(app.server, current.accessToken).expect(401);
    });

    it('answers 404 for a session of another account, and leaves it open', async () => {
      await register(app.server, { username: 'other', email: 'other@example.com' }).expect(201);
      const theirs = await openSession('other');
      const mine = await openSession();

      const response = await revokeSession(app.server, mine.accessToken, theirs.id).expect(404);

      expect(response.body.errors).toEqual([expect.objectContaining({ status: '404' })]);
      await getMe(app.server, theirs.accessToken).expect(200);
    });

    it('answers 404 for an unknown, malformed or already revoked session', async () => {
      const phone = await openSession();
      const laptop = await openSession();
      await revokeSession(app.server, laptop.accessToken, phone.id).expect(204);

      await revokeSession(app.server, laptop.accessToken, phone.id).expect(404);
      await revokeSession(app.server, laptop.accessToken, '999999').expect(404);
      await revokeSession(app.server, laptop.accessToken, 'abc').expect(404);
    });

    it('requires an access token', async () => {
      const phone = await openSession();

      await revokeSession(app.server, 'not-a-token', phone.id).expect(401);
    });
  });
});
