import { DataSource } from 'typeorm';
import { getMe, setAccountStatus } from '../support/accounts';
import { Account, changeRole, listRoleChanges, registerFirstAdmin, registerVerified } from '../support/administration';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('role changes', () => {
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

  const roleOf = async (account: Account) => (await getMe(app.server, account.accessToken).expect(200)).body.data.attributes.role;

  describe('POST /v1/admin/users/{id}/role-changes', () => {
    it('changes the role of an account and returns the audited change', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      app.clock.advance(MINUTE);

      const response = await changeRole(app, admin.accessToken, diego.uuid, {
        newRole: 'moderator',
        reason: '  Moderará el catálogo K-pop  ',
      }).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'role-changes',
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          attributes: {
            previousRole: 'user',
            newRole: 'moderator',
            reason: 'Moderará el catálogo K-pop',
            changedAt: '2026-01-01T00:01:00.000Z',
          },
          relationships: {
            user: { data: { type: 'users', id: diego.uuid } },
            changedBy: { data: { type: 'users', id: admin.uuid } },
          },
        },
        links: { self: `/v1/admin/users/${diego.uuid}/role-changes` },
      });
      expect(await roleOf(diego)).toBe('moderator');
    });

    it('lets an administrator promote another administrator, who can then change roles', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      const otra = await registerVerified(app, 'otra');

      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Segundo administrador' }).expect(201);
      await changeRole(app, diego.accessToken, otra.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);

      expect(await roleOf(otra)).toBe('moderator');
    });

    it.each([
      [{ newRole: 'superadmin', reason: 'Motivo' }, '/data/attributes/newRole'],
      [{ reason: 'Motivo' }, '/data/attributes/newRole'],
      [{ newRole: 'moderator' }, '/data/attributes/reason'],
      [{ newRole: 'moderator', reason: '   ' }, '/data/attributes/reason'],
      [{ newRole: 'moderator', reason: 'x'.repeat(1001) }, '/data/attributes/reason'],
    ])('validates the role and requires a reason (%j)', async (attributes, pointer) => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await changeRole(app, admin.accessToken, diego.uuid, attributes).expect(422);

      expect(response.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: { pointer } })]));
      expect(await roleOf(diego)).toBe('user');
    });

    it('answers 404 for an unknown account', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        await changeRole(app, admin.accessToken, id, { newRole: 'moderator', reason: 'Motivo' }).expect(404);
      }
    });

    it('refuses to give an account the role it already has', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'user', reason: 'Motivo' }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'role_unchanged' })]);
    });

    it('refuses to change the role of a deleted account', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'deleted');

      const response = await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Motivo' }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'account_deleted' })]);
    });

    it('refuses to demote the last active verified administrator, also by themselves', async () => {
      const response = await changeRole(app, admin.accessToken, admin.uuid, { newRole: 'user', reason: 'Me retiro' }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'last_administrator' })]);
      expect(await roleOf(admin)).toBe('admin');
    });

    it('demotes an administrator while another operational administrator remains', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);

      await changeRole(app, admin.accessToken, admin.uuid, { newRole: 'user', reason: 'Me retiro' }).expect(201);

      expect(await roleOf(admin)).toBe('user');
      // Without the role, the former administrator can no longer change roles.
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'user', reason: 'Motivo' }).expect(403);
    });

    it('does not count a suspended administrator as the one that remains', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');

      await changeRole(app, admin.accessToken, admin.uuid, { newRole: 'user', reason: 'Me retiro' }).expect(409);
    });

    it('lets only one of two simultaneous changes from the same role apply', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const responses = await Promise.all([
        changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Primera' }),
        changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Segunda' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const audit = await listRoleChanges(app, admin.accessToken, diego.uuid).expect(200);
      expect(audit.body.meta.total).toBe(1);
    });

    it('keeps an operational administrator when two administrators demote each other at the same time', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);

      const responses = await Promise.all([
        changeRole(app, admin.accessToken, diego.uuid, { newRole: 'user', reason: 'Fuera' }),
        changeRole(app, diego.accessToken, admin.uuid, { newRole: 'user', reason: 'Fuera' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 403]);
      expect([await roleOf(admin), await roleOf(diego)].sort()).toEqual(['admin', 'user']);
    });

    it.each(['user', 'moderator'] as const)('answers 403 to a %s', async (role) => {
      const diego = await registerVerified(app, 'diego_papi');
      const otra = await registerVerified(app, 'otra');
      if (role === 'moderator') {
        await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      }

      await changeRole(app, diego.accessToken, otra.uuid, { newRole: 'moderator', reason: 'Motivo' }).expect(403);
      await changeRole(app, diego.accessToken, diego.uuid, { newRole: 'admin', reason: 'Motivo' }).expect(403);
      await listRoleChanges(app, diego.accessToken, otra.uuid).expect(403);
    });

    it('requires an access token', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      await changeRole(app, 'not-a-token', diego.uuid, { newRole: 'moderator', reason: 'Motivo' }).expect(401);
      await listRoleChanges(app, 'not-a-token', diego.uuid).expect(401);
    });
  });

  describe('GET /v1/admin/users/{id}/role-changes', () => {
    it('lists the role changes of the account, newest first, including the bootstrap', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      app.clock.advance(MINUTE);
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      app.clock.advance(MINUTE);
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Ascenso' }).expect(201);

      const response = await listRoleChanges(app, admin.accessToken, diego.uuid).expect(200);

      expect(response.body.data.map((change: { attributes: object }) => change.attributes)).toEqual([
        { previousRole: 'moderator', newRole: 'admin', reason: 'Ascenso', changedAt: '2026-01-01T00:02:00.000Z' },
        { previousRole: 'user', newRole: 'moderator', reason: 'Moderación', changedAt: '2026-01-01T00:01:00.000Z' },
      ]);
      expect(response.body.meta).toEqual({ total: 2 });

      const bootstrap = await listRoleChanges(app, admin.accessToken, admin.uuid).expect(200);
      expect(bootstrap.body.data).toEqual([
        expect.objectContaining({
          attributes: expect.objectContaining({ previousRole: 'user', newRole: 'admin', reason: 'Primer administrador de la prueba' }),
          relationships: { user: { data: { type: 'users', id: admin.uuid } }, changedBy: { data: null } },
        }),
      ]);
    });

    it('answers 404 for an unknown account', async () => {
      await listRoleChanges(app, admin.accessToken, '00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('rejects unsupported query parameters', async () => {
      await listRoleChanges(app, admin.accessToken, admin.uuid).query({ 'filter[role]': 'admin' }).expect(400);
    });
  });
});
