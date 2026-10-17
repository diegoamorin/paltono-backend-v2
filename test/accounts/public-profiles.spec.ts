import request from 'supertest';
import { deleteAccount, updateProfile } from '../support/accounts';
import { Account, changeStatus, registerFirstAdmin, registerVerified } from '../support/administration';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('public profiles', () => {
  let app: TestApp;
  let admin: Account;
  let diego: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    app.clock.advance(MINUTE);
    diego = await registerVerified(app, 'diego_papi');
    await updateProfile(app.server, diego.accessToken, diego.uuid, {
      avatarUrl: 'https://cdn.example.com/diego.png',
      bio: 'Fan de BLACKPINK',
    }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.server).get(path).set('Accept', JSON_API);

  describe('GET /v1/users/{id}', () => {
    it('shows the public profile to anyone, without the email or other private data', async () => {
      const response = await get(`/v1/users/${diego.uuid}`).expect(200);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'users',
          id: diego.uuid,
          attributes: {
            username: 'diego_papi',
            displayName: 'Diego 🎤',
            avatarUrl: 'https://cdn.example.com/diego.png',
            bio: 'Fan de BLACKPINK',
            role: 'user',
            status: 'active',
            createdAt: '2026-01-01T00:01:00.000Z',
          },
        },
        links: { self: `/v1/users/${diego.uuid}` },
      });
    });

    it('shows that an account is suspended', async () => {
      await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Spam' }).expect(201);

      const response = await get(`/v1/users/${diego.uuid}`).expect(200);

      expect(response.body.data.attributes).toEqual(expect.objectContaining({ status: 'suspended', bio: 'Fan de BLACKPINK' }));
      expect(JSON.stringify(response.body)).not.toContain('Spam');
    });

    it('shows only the reserved username of a deleted account', async () => {
      await deleteAccount(app.server, diego.accessToken).expect(204);

      const response = await get(`/v1/users/${diego.uuid}`).expect(200);

      expect(response.body.data.attributes).toEqual({
        username: 'diego_papi',
        displayName: null,
        avatarUrl: null,
        bio: null,
        role: null,
        status: 'deleted',
        createdAt: null,
      });
    });

    it('answers 404 for an unknown account', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'diego_papi']) {
        const response = await get(`/v1/users/${id}`).expect(404);
        expect(response.body.errors).toEqual([expect.objectContaining({ code: 'account_not_found' })]);
      }
    });

    it('accepts sparse fieldsets and refuses other parameters', async () => {
      const response = await get(`/v1/users/${diego.uuid}?fields[users]=username,role`).expect(200);

      expect(response.body.data.attributes).toEqual({ username: 'diego_papi', role: 'user' });
      await get(`/v1/users/${diego.uuid}?fields[users]=email`).expect(400);
      await get(`/v1/users/${diego.uuid}?include=sessions`).expect(400);
    });
  });

  describe('GET /v1/users?filter[username]=', () => {
    it('finds the account with that username, ignoring case', async () => {
      const response = await get('/v1/users?filter[username]=Diego_Papi').expect(200);

      expect(response.body.data).toEqual([
        expect.objectContaining({ type: 'users', id: diego.uuid, attributes: expect.objectContaining({ username: 'diego_papi' }) }),
      ]);
      expect(response.body.data[0].attributes).not.toHaveProperty('email');
      expect(response.body.meta).toEqual({ total: 1 });
    });

    it('finds nothing for a username no account has', async () => {
      const response = await get('/v1/users?filter[username]=nadie').expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta).toEqual({ total: 0 });
    });

    it('finds the reserved username of a deleted account', async () => {
      await deleteAccount(app.server, diego.accessToken).expect(204);

      const response = await get('/v1/users?filter[username]=diego_papi').expect(200);

      expect(response.body.data).toEqual([
        expect.objectContaining({ id: diego.uuid, attributes: expect.objectContaining({ status: 'deleted', displayName: null }) }),
      ]);
    });

    it('does not list accounts: the username filter is required and the only one', async () => {
      for (const path of ['/v1/users', '/v1/users?filter[username]=', '/v1/users?filter[q]=diego', '/v1/users?sort=username']) {
        const response = await get(path).expect(400);
        expect(response.body.errors).toEqual([expect.objectContaining({ status: '400' })]);
      }
      for (const path of ['/v1/users', '/v1/users?filter[username]=']) {
        const response = await get(path).expect(400);
        expect(response.body.errors).toEqual([expect.objectContaining({ code: 'username_filter_required' })]);
      }
    });
  });
});
