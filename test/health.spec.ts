import request from 'supertest';
import { TestApp, createTestApp } from './support/test-app';

describe('GET /health', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds with plain JSON after checking the database', async () => {
    const response = await request(app.server).get('/health').expect(200);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('does not require the JSON:API media type', async () => {
    await request(app.server).get('/health').set('Accept', 'application/json').expect(200);
  });
});
