import request from 'supertest';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';
import { WidgetsFixtureModule } from '../support/widgets-fixture';

describe('JSON:API media type on /v1', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ imports: [WidgetsFixtureModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const validBody = { data: { type: 'widgets', attributes: { name: 'Lightstick', price: 30 } } };

  describe('Accept', () => {
    it.each([
      ['the JSON:API media type', JSON_API],
      ['the JSON:API media type with a profile', `${JSON_API}; profile="https://example.com/p"`],
      ['a wildcard', '*/*'],
      ['an application wildcard', 'application/*'],
      ['a list including the JSON:API media type', `text/html, ${JSON_API}; charset=utf-8, ${JSON_API}`],
    ])('serves %s with the JSON:API content type', async (_case, accept) => {
      const response = await request(app.server).get('/v1/widgets').set('Accept', accept).expect(200);

      expect(response.headers['content-type']).toBe(JSON_API);
    });

    it('serves requests without an Accept header', async () => {
      await request(app.server).get('/v1/widgets').unset('Accept').expect(200);
    });

    it.each([
      ['another media type', 'application/json'],
      ['only JSON:API instances with unsupported parameters', `${JSON_API}; charset=utf-8`],
      ['an unsupported extension', `${JSON_API}; ext="https://jsonapi.org/ext/atomic"`],
    ])('responds 406 to %s', async (_case, accept) => {
      const response = await request(app.server).get('/v1/widgets').set('Accept', accept).expect(406);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        errors: [expect.objectContaining({ status: '406', title: 'Not Acceptable' })],
      });
    });
  });

  describe('Content-Type', () => {
    it('accepts a body with the JSON:API media type', async () => {
      await request(app.server)
        .post('/v1/widgets')
        .set('Accept', JSON_API)
        .set('Content-Type', JSON_API)
        .send(JSON.stringify(validBody))
        .expect(201);
    });

    it('accepts a body with a profile parameter', async () => {
      await request(app.server)
        .post('/v1/widgets')
        .set('Accept', JSON_API)
        .set('Content-Type', `${JSON_API}; profile="https://example.com/p"`)
        .send(JSON.stringify(validBody))
        .expect(201);
    });

    it.each([
      ['another media type', 'application/json'],
      ['an unsupported parameter', `${JSON_API}; charset=utf-8`],
      ['an unsupported extension', `${JSON_API}; ext="https://jsonapi.org/ext/atomic"`],
    ])('responds 415 to %s', async (_case, contentType) => {
      const response = await request(app.server)
        .post('/v1/widgets')
        .set('Accept', JSON_API)
        .set('Content-Type', contentType)
        .send(JSON.stringify(validBody))
        .expect(415);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body.errors).toEqual([expect.objectContaining({ status: '415', title: 'Unsupported Media Type' })]);
    });

    it('responds 415 to a body without Content-Type', async () => {
      await request(app.server)
        .post('/v1/widgets')
        .set('Accept', JSON_API)
        .send(Buffer.from(JSON.stringify(validBody)))
        .unset('Content-Type')
        .expect(415);
    });
  });
});
