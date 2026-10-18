import { register, setAccountStatus } from '../support/accounts';
import { Account, registerFirstAdmin, registerVerified } from '../support/administration';
import { getJsonApi, reserveEntity, reserveIdentity } from '../support/editorial';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';
import { accessTokenFor } from '../support/accounts';
import { DataSource } from 'typeorm';

describe('editorial entities', () => {
  let app: TestApp;
  let diego: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    diego = await registerVerified(app, 'diego_papi');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/editorial-entities', () => {
    it('reserves an identity root at version 0 for its author', async () => {
      const response = await reserveEntity(app, diego.accessToken).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      const { id } = response.body.data;
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'editorial-entities',
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          attributes: {
            entityType: 'identity',
            publicationStatus: 'reserved',
            currentVersion: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            publishedAt: null,
            withdrawnAt: null,
          },
          relationships: { createdBy: { data: { type: 'users', id: diego.uuid } } },
        },
        links: { self: `/v1/editorial-entities/${id}` },
      });
    });

    it.each(['tour', 'users', ''])('refuses entity types without a registered creation (%j)', async (entityType) => {
      const response = await reserveEntity(app, diego.accessToken, entityType).expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/attributes/entityType' } })]);
    });

    it('requires a verified account', async () => {
      await register(app.server, { username: 'sin_verificar', email: 'sin@example.com' }).expect(201);

      await reserveEntity(app, await accessTokenFor(app.server, 'sin_verificar')).expect(403);
      await reserveEntity(app, 'not-a-token').expect(401);
    });

    it('refuses a suspended account', async () => {
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');

      await reserveEntity(app, diego.accessToken).expect(401);
    });
  });

  describe('GET /v1/editorial-entities/{id}', () => {
    it('shows a reservation to its creator', async () => {
      const id = await reserveIdentity(app, diego.accessToken);

      const response = await getJsonApi(app, `/v1/editorial-entities/${id}`, diego.accessToken).expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({ id, attributes: expect.objectContaining({ publicationStatus: 'reserved', currentVersion: 0 }) }),
      );
    });

    it('answers 404 for a reservation to anyone else, staff included', async () => {
      const id = await reserveIdentity(app, diego.accessToken);
      const admin = await registerFirstAdmin(app);
      const other = await registerVerified(app, 'otra_cuenta');

      await getJsonApi(app, `/v1/editorial-entities/${id}`).expect(404);
      await getJsonApi(app, `/v1/editorial-entities/${id}`, other.accessToken).expect(404);
      await getJsonApi(app, `/v1/editorial-entities/${id}`, admin.accessToken).expect(404);
    });

    it('answers 404 for unknown ids', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        await getJsonApi(app, `/v1/editorial-entities/${id}`).expect(404);
      }
    });

    it('refuses an invalid access token instead of answering as the public', async () => {
      const id = await reserveIdentity(app, diego.accessToken);

      await getJsonApi(app, `/v1/editorial-entities/${id}`, 'not-a-token').expect(401);
    });
  });
});
