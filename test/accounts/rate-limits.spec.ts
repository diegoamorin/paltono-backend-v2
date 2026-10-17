import request from 'supertest';
import { accessTokenFor, getMe, login, register, requestVerification } from '../support/accounts';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

describe('rate limits on login, registration and verification resends', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ env: { AUTH_RATE_LIMIT: '3' } });
    await app.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('limits registrations', async () => {
    for (let index = 0; index < 3; index++) {
      await register(app.server, { username: `fan${index}`, email: `fan${index}@example.com` }).expect(201);
    }

    const response = await register(app.server, { username: 'fan3', email: 'fan3@example.com' }).expect(429);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body.errors).toEqual([expect.objectContaining({ status: '429', title: 'Too Many Requests' })]);
    expect(response.headers['retry-after']).toEqual(expect.any(String));
  });

  it('limits logins, counting failed attempts too', async () => {
    await register(app.server).expect(201);
    await login(app.server, { identifier: 'diego_papi', password: 'wrong password' }).expect(401);
    await login(app.server, { identifier: 'diego_papi', password: 'wrong password' }).expect(401);
    await login(app.server, { identifier: 'diego_papi' }).expect(201);

    await login(app.server, { identifier: 'diego_papi' }).expect(429);
  });

  it('limits verification resends', async () => {
    await register(app.server).expect(201);
    const accessToken = await accessTokenFor(app.server, 'diego_papi');
    for (let index = 0; index < 3; index++) await requestVerification(app.server, accessToken).expect(202);

    await requestVerification(app.server, accessToken).expect(429);
  });

  it('counts each route separately and leaves other routes alone', async () => {
    for (let index = 0; index < 3; index++) {
      await register(app.server, { username: `fan${index}`, email: `fan${index}@example.com` }).expect(201);
    }
    await register(app.server, { username: 'fan3', email: 'fan3@example.com' }).expect(429);

    const accessToken = await accessTokenFor(app.server, 'fan0');
    for (let index = 0; index < 5; index++) await getMe(app.server, accessToken).expect(200);
    await request(app.server).get('/health').expect(200);
  });
});
