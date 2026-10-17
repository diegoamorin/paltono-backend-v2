import { login, register } from '../support/accounts';
import {
  Account,
  changeRole,
  changeStatus,
  getAccount,
  listAccounts,
  registerFirstAdmin,
  registerVerified,
} from '../support/administration';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('account administration', () => {
  let app: TestApp;
  let admin: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const usernames = (body: { data: { attributes: { username: string } }[] }) =>
    body.data.map((account) => account.attributes.username);

  describe('GET /v1/admin/users', () => {
    it('lists accounts with their email, newest first', async () => {
      app.clock.advance(MINUTE);
      const diego = await registerVerified(app, 'diego_papi');
      app.clock.advance(MINUTE);
      await register(app.server, { username: 'sin_verificar', email: 'sin_verificar@example.com', displayName: 'Nueva' }).expect(201);

      const response = await listAccounts(app, admin.accessToken).expect(200);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(usernames(response.body)).toEqual(['sin_verificar', 'diego_papi', 'admin']);
      expect(response.body.data[1]).toEqual({
        type: 'users',
        id: diego.uuid,
        attributes: {
          username: 'diego_papi',
          email: 'diego_papi@example.com',
          displayName: 'Diego 🎤',
          avatarUrl: null,
          bio: null,
          emailVerified: true,
          role: 'user',
          status: 'active',
          createdAt: '2026-01-01T00:01:00.000Z',
          lastLoginAt: '2026-01-01T00:01:00.000Z',
          usernameChangedAt: '2026-01-01T00:01:00.000Z',
        },
      });
      expect(response.body.meta).toEqual({ total: 3 });
      expect(response.body.links.first).toBe('/v1/admin/users?page%5Bnumber%5D=1&page%5Bsize%5D=20');
    });

    it('filters by text over username, email and display name', async () => {
      await registerVerified(app, 'diego_papi');
      await register(app.server, { username: 'jisoo', email: 'contacto@blink.example', displayName: 'Kim Jisoo' }).expect(201);
      await register(app.server, { username: 'lisa', email: 'lisa@example.com', displayName: 'Lalisa 100%' }).expect(201);

      const byUsername = await listAccounts(app, admin.accessToken).query({ 'filter[q]': 'O_PAP' }).expect(200);
      const byEmail = await listAccounts(app, admin.accessToken).query({ 'filter[q]': 'blink' }).expect(200);
      const byDisplayName = await listAccounts(app, admin.accessToken).query({ 'filter[q]': 'lalisa' }).expect(200);
      const literalWildcard = await listAccounts(app, admin.accessToken).query({ 'filter[q]': '%' }).expect(200);

      expect(usernames(byUsername.body)).toEqual(['diego_papi']);
      expect(usernames(byEmail.body)).toEqual(['jisoo']);
      expect(usernames(byDisplayName.body)).toEqual(['lisa']);
      expect(usernames(literalWildcard.body)).toEqual(['lisa']);
    });

    it('filters by role, status and email verification', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      const otra = await registerVerified(app, 'otra');
      await register(app.server, { username: 'sin_verificar', email: 'sin_verificar@example.com' }).expect(201);
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      await changeStatus(app, admin.accessToken, otra.uuid, { newStatus: 'suspended', reason: 'Spam' }).expect(201);

      const query = (filter: object) => listAccounts(app, admin.accessToken).query(filter).expect(200);

      expect(usernames((await query({ 'filter[role]': 'moderator' })).body)).toEqual(['diego_papi']);
      expect(usernames((await query({ 'filter[status]': 'suspended' })).body)).toEqual(['otra']);
      expect(usernames((await query({ 'filter[emailVerified]': 'false' })).body)).toEqual(['sin_verificar']);
      expect(usernames((await query({ 'filter[emailVerified]': 'true', 'filter[status]': 'active' })).body).sort()).toEqual([
        'admin',
        'diego_papi',
      ]);
    });

    it('sorts by username and by last login, never-logged-in accounts last', async () => {
      await register(app.server, { username: 'zeta', email: 'zeta@example.com' }).expect(201);
      app.clock.advance(MINUTE);
      await registerVerified(app, 'beta');
      app.clock.advance(MINUTE);
      await login(app.server, { identifier: 'admin' }).expect(201);

      const byUsername = await listAccounts(app, admin.accessToken).query({ sort: 'username' }).expect(200);
      const byLastLogin = await listAccounts(app, admin.accessToken).query({ sort: '-lastLoginAt' }).expect(200);
      const byFirstLogin = await listAccounts(app, admin.accessToken).query({ sort: 'lastLoginAt' }).expect(200);

      expect(usernames(byUsername.body)).toEqual(['admin', 'beta', 'zeta']);
      expect(usernames(byLastLogin.body)).toEqual(['admin', 'beta', 'zeta']);
      expect(usernames(byFirstLogin.body)).toEqual(['beta', 'admin', 'zeta']);
    });

    it.each([
      { 'filter[role]': 'superadmin' },
      { 'filter[status]': 'banned' },
      { 'filter[emailVerified]': 'yes' },
      { 'filter[username]': 'admin' },
      { sort: 'email' },
      { include: 'roleChanges' },
    ])('rejects an unsupported query (%j)', async (query) => {
      await listAccounts(app, admin.accessToken).query(query).expect(400);
    });

    it.each(['user', 'moderator'] as const)('answers 403 to a %s', async (role) => {
      const diego = await registerVerified(app, 'diego_papi');
      if (role === 'moderator') {
        await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      }

      await listAccounts(app, diego.accessToken).expect(403);
      await getAccount(app, diego.accessToken, admin.uuid).expect(403);
    });

    it('requires an access token', async () => {
      await listAccounts(app, 'not-a-token').expect(401);
      await getAccount(app, 'not-a-token', admin.uuid).expect(401);
    });
  });

  describe('GET /v1/admin/users/{id}', () => {
    it('shows an account with its email', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await getAccount(app, admin.accessToken, diego.uuid).expect(200);

      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: expect.objectContaining({
          type: 'users',
          id: diego.uuid,
          attributes: expect.objectContaining({ username: 'diego_papi', email: 'diego_papi@example.com', status: 'active' }),
        }),
        links: { self: `/v1/admin/users/${diego.uuid}` },
      });
    });

    it('shows a deleted account without its personal data', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Spam' }).expect(201);
      await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'deleted', reason: 'Baja por soporte' }).expect(201);

      const response = await getAccount(app, admin.accessToken, diego.uuid).expect(200);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({
          username: 'diego_papi',
          email: null,
          displayName: 'diego_papi',
          avatarUrl: null,
          bio: null,
          status: 'deleted',
        }),
      );
    });

    it('answers 404 for an unknown account', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        await getAccount(app, admin.accessToken, id).expect(404);
      }
    });
  });
});
