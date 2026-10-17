import request from 'supertest';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';
import { WidgetsFixtureModule } from '../support/widgets-fixture';

describe('JSON:API error documents', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ imports: [WidgetsFixtureModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: string | object) =>
    request(app.server)
      .post('/v1/widgets')
      .set('Accept', JSON_API)
      .set('Content-Type', JSON_API)
      .send(typeof body === 'string' ? body : JSON.stringify(body));

  it('responds 404 to an unknown route', async () => {
    const response = await request(app.server).get('/v1/nowhere').set('Accept', JSON_API).expect(404);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body).toEqual({
      jsonapi: { version: '1.1' },
      errors: [expect.objectContaining({ status: '404', title: 'Not Found' })],
    });
  });

  it('responds 404 to an unknown resource', async () => {
    const response = await request(app.server).get('/v1/widgets/999').set('Accept', JSON_API).expect(404);

    expect(response.body.errors).toEqual([expect.objectContaining({ status: '404', title: 'Not Found' })]);
  });

  it('responds 400 to a malformed JSON body', async () => {
    const response = await post('{"data": ').expect(400);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body.errors).toEqual([expect.objectContaining({ status: '400', title: 'Bad Request' })]);
  });

  it('responds 422 with a pointer to each invalid member', async () => {
    const response = await post({
      data: { type: 'widgets', attributes: { name: '', price: -1, colour: 'red' } },
    }).expect(422);

    const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
    expect(pointers.sort()).toEqual(['/data/attributes/colour', '/data/attributes/name', '/data/attributes/price']);
    for (const error of response.body.errors) {
      expect(error).toMatchObject({ status: '422', title: 'Unprocessable Entity', detail: expect.any(String) });
    }
  });

  it('responds 422 when the primary data is missing', async () => {
    const response = await post({ meta: {} }).expect(422);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: { pointer: '/data' } })]),
    );
  });

  it('responds 500 without leaking internals', async () => {
    const response = await request(app.server).get('/v1/widgets/explode').set('Accept', JSON_API).expect(500);

    expect(response.body).toEqual({
      jsonapi: { version: '1.1' },
      errors: [{ status: '500', title: 'Internal Server Error' }],
    });
  });
});
