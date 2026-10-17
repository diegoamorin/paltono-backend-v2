import request from 'supertest';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

describe('GET /v1/editorial-operations', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the identity creation with the JSON Schema of its payload, without authentication', async () => {
    const response = await request(app.server).get('/v1/editorial-operations').set('Accept', JSON_API).expect(200);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body.meta).toEqual({ total: 1 });
    const [operation] = response.body.data;
    expect(operation).toEqual({
      type: 'editorial-operations',
      id: 'identity.create_entity.catalog_identities.v1',
      attributes: expect.objectContaining({
        entityType: 'identity',
        operation: 'create_entity',
        targetPath: 'catalog_identities',
        targetKey: null,
        payloadSchemaVersion: 1,
        baseValue: { exists: false },
      }),
    });
    const schema = operation.attributes.payloadSchema;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual(['exists', 'value']);
    expect(schema.properties.value.properties.type).toEqual({ enum: ['person', 'organization'] });
  });

  it('rejects query parameters it does not support', async () => {
    await request(app.server).get('/v1/editorial-operations?filter[table]=users').set('Accept', JSON_API).expect(400);
  });
});
