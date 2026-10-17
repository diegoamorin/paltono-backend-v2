import request from 'supertest';
import { DataSource } from 'typeorm';
import { accessTokenFor, getMe, login, logout, refreshSession, register, sendJsonApi, setAccountStatus } from '../support/accounts';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe('POST /v1/session-refreshes', () => {
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

  it('gives a mobile client a new access token and a new refresh token in the body', async () => {
    const loggedIn = await login(app.server, { identifier: 'diego_papi', client: 'mobile' }).expect(201);
    app.clock.advance(60 * 60 * 1000);

    const response = await refreshSession(app.server, { refreshToken: loggedIn.body.meta.refreshToken }).expect(200);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toEqual({
      jsonapi: { version: '1.1' },
      data: loggedIn.body.data,
      links: { self: '/v1/sessions/current' },
      meta: {
        accessToken: expect.any(String),
        accessTokenExpiresAt: '2026-01-01T01:15:00.000Z',
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    expect(response.body.meta.refreshToken).not.toBe(loggedIn.body.meta.refreshToken);
    await getMe(app.server, response.body.meta.accessToken).expect(200);
  });

  it('gives a web client the new refresh token in a secure cookie only', async () => {
    const loggedIn = await login(app.server, { identifier: 'diego_papi', client: 'web' }).expect(201);
    const [loginCookie] = loggedIn.headers['set-cookie'] as unknown as string[];

    const response = await refreshSession(app.server, { cookie: loginCookie }).expect(200);

    expect(response.body.meta).not.toHaveProperty('refreshToken');
    const [cookie] = response.headers['set-cookie'] as unknown as string[];
    expect(cookie).toMatch(/^paltono_refresh_token=[A-Za-z0-9_-]{43};/);
    expect(cookie.split(';')[0]).not.toBe(loginCookie.split(';')[0]);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\/v1/);
    expect(cookie).toMatch(/; Expires=Sat, 31 Jan 2026 00:00:00 GMT/);
    await getMe(app.server, response.body.meta.accessToken).expect(200);
  });

  it('rejects a refresh token once it has been replaced, and keeps the replacement working', async () => {
    const first = await mobileRefreshToken();
    const refreshed = await refreshSession(app.server, { refreshToken: first }).expect(200);

    const response = await refreshSession(app.server, { refreshToken: first }).expect(401);

    expect(response.body.errors).toEqual([expect.objectContaining({ status: '401', code: 'invalid_refresh_token' })]);
    await refreshSession(app.server, { refreshToken: refreshed.body.meta.refreshToken }).expect(200);
  });

  it('lets only one of several simultaneous refreshes with the same token succeed', async () => {
    const refreshToken = await mobileRefreshToken();

    const responses = await Promise.all(Array.from({ length: 8 }, () => refreshSession(app.server, { refreshToken })));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401, 401, 401, 401, 401, 401, 401]);
    const winner = responses.find((response) => response.status === 200)!;
    await refreshSession(app.server, { refreshToken: winner.body.meta.refreshToken }).expect(200);
  });

  it('never extends the absolute 30-day limit of the session', async () => {
    let refreshToken = await mobileRefreshToken();

    app.clock.advance(30 * DAY - 10 * MINUTE);
    const late = await refreshSession(app.server, { refreshToken }).expect(200);
    expect(late.body.data.attributes.expiresAt).toBe('2026-01-31T00:00:00.000Z');
    expect(late.body.meta.accessTokenExpiresAt).toBe('2026-01-31T00:00:00.000Z');
    refreshToken = late.body.meta.refreshToken;

    app.clock.advance(10 * MINUTE);
    await refreshSession(app.server, { refreshToken }).expect(401);
    await getMe(app.server, late.body.meta.accessToken).expect(401);
  });

  it('rejects the refresh token of a session that was logged out', async () => {
    const loggedIn = await login(app.server, { identifier: 'diego_papi', client: 'mobile' }).expect(201);
    await logout(app.server, loggedIn.body.meta.accessToken).expect(204);

    await refreshSession(app.server, { refreshToken: loggedIn.body.meta.refreshToken }).expect(401);
  });

  it('rejects the refresh token of a suspended or deleted account', async () => {
    await register(app.server, { username: 'other', email: 'other@example.com' }).expect(201);
    const suspended = await mobileRefreshToken('diego_papi');
    const deleted = await mobileRefreshToken('other');
    await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');
    await setAccountStatus(app.app.get(DataSource), 'other', 'deleted');

    await refreshSession(app.server, { refreshToken: suspended }).expect(401);
    await refreshSession(app.server, { refreshToken: deleted }).expect(401);
  });

  it('rejects a request without a refresh token, or with an unknown one', async () => {
    await refreshSession(app.server, {}).expect(401);
    await refreshSession(app.server, { refreshToken: 'x'.repeat(43) }).expect(401);
    await refreshSession(app.server, { cookie: `paltono_refresh_token=${'x'.repeat(43)}` }).expect(401);
  });

  it('does not need an access token, so an expired one is no obstacle', async () => {
    await accessTokenFor(app.server, 'diego_papi');
    const refreshToken = await mobileRefreshToken();
    app.clock.advance(20 * MINUTE);

    await refreshSession(app.server, { refreshToken }).expect(200);
  });

  it('validates the body', async () => {
    const refreshToken = await mobileRefreshToken();

    const response = await sendJsonApi(app.server, 'post', '/v1/session-refreshes', {
      data: { type: 'sessions', attributes: { refreshToken } },
    }).expect(422);

    expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/type' } })]);
  });

  it('refuses a cookie sent with a content type a cross-site form could use, as CSRF protection', async () => {
    const loggedIn = await login(app.server, { identifier: 'diego_papi', client: 'web' }).expect(201);
    const [cookie] = loggedIn.headers['set-cookie'] as unknown as string[];

    for (const contentType of ['application/x-www-form-urlencoded', 'text/plain']) {
      await request(app.server)
        .post('/v1/session-refreshes')
        .set('Accept', JSON_API)
        .set('Content-Type', contentType)
        .set('Cookie', cookie.split(';')[0])
        .send('data=x')
        .expect(415);
    }
  });

  async function mobileRefreshToken(identifier = 'diego_papi'): Promise<string> {
    const response = await login(app.server, { identifier, client: 'mobile' }).expect(201);
    return response.body.meta.refreshToken;
  }
});
