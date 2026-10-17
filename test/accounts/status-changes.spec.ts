import { accessTokenFor, getMe, login, register, requestPasswordReset, resetPassword } from '../support/accounts';
import {
  Account,
  changeRole,
  changeStatus,
  listStatusChanges,
  registerFirstAdmin,
  registerVerified,
} from '../support/administration';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('status changes', () => {
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

  const suspend = (account: Account, reason = 'Spam en las propuestas') =>
    changeStatus(app, admin.accessToken, account.uuid, { newStatus: 'suspended', reason }).expect(201);

  describe('POST /v1/admin/users/{id}/status-changes', () => {
    it('suspends an account, returns the audited change and ends its sessions at once', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      app.clock.advance(MINUTE);

      const response = await changeStatus(app, admin.accessToken, diego.uuid, {
        newStatus: 'suspended',
        reason: '  Spam en las propuestas  ',
      }).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'status-changes',
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          attributes: {
            previousStatus: 'active',
            newStatus: 'suspended',
            reason: 'Spam en las propuestas',
            changedAt: '2026-01-01T00:01:00.000Z',
          },
          relationships: {
            user: { data: { type: 'users', id: diego.uuid } },
            changedBy: { data: { type: 'users', id: admin.uuid } },
          },
        },
        links: { self: `/v1/admin/users/${diego.uuid}/status-changes` },
      });
      // The access token is still unexpired, but its session is over.
      await getMe(app.server, diego.accessToken).expect(401);
    });

    it('makes the login of a suspended account say so only when the password is right, without the reason', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await suspend(diego, 'Motivo interno');

      const right = await login(app.server, { identifier: 'diego_papi' }).expect(403);
      const wrong = await login(app.server, { identifier: 'diego_papi', password: 'not the password' }).expect(401);

      expect(right.body.errors).toEqual([expect.objectContaining({ code: 'account_suspended' })]);
      expect(JSON.stringify(right.body)).not.toContain('Motivo interno');
      expect(wrong.body.errors).toEqual([expect.objectContaining({ code: 'invalid_credentials' })]);
    });

    it('does not end a suspension by itself', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await suspend(diego);

      app.clock.advance(365 * 24 * 60 * MINUTE);

      await login(app.server, { identifier: 'diego_papi' }).expect(403);
    });

    it('reactivates a suspended account, which can then log in again', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await suspend(diego);

      const response = await changeStatus(app, admin.accessToken, diego.uuid, {
        newStatus: 'active',
        reason: 'Apelación aceptada',
      }).expect(201);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({ previousStatus: 'suspended', newStatus: 'active', reason: 'Apelación aceptada' }),
      );
      await getMe(app.server, await accessTokenFor(app.server, 'diego_papi')).expect(200);
    });

    it('deletes a suspended account at the request of its holder, freeing its email and keeping its username reserved', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await suspend(diego);
      await requestPasswordReset(app.server, 'diego_papi@example.com').expect(202);
      const pendingReset = app.mailer.lastToken('diego_papi@example.com', 'password-reset');

      const response = await changeStatus(app, admin.accessToken, diego.uuid, {
        newStatus: 'deleted',
        reason: 'Pidió la baja por soporte',
      }).expect(201);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({ previousStatus: 'suspended', newStatus: 'deleted', reason: 'Pidió la baja por soporte' }),
      );
      await login(app.server, { identifier: 'diego_papi' }).expect(401);
      await resetPassword(app.server, pendingReset, 'a brand new passphrase').expect(422);
      await register(app.server, { username: 'diego_nuevo', email: 'diego_papi@example.com' }).expect(201);
      await register(app.server, { username: 'diego_papi', email: 'otro@example.com' }).expect(409);
    });

    it('refuses to delete an account that is not suspended', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await changeStatus(app, admin.accessToken, diego.uuid, {
        newStatus: 'deleted',
        reason: 'Pidió la baja',
      }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'account_not_suspended' })]);
      await getMe(app.server, diego.accessToken).expect(200);
    });

    it('refuses any change to a deleted account', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await suspend(diego);
      await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'deleted', reason: 'Baja' }).expect(201);

      for (const newStatus of ['active', 'suspended', 'deleted']) {
        const response = await changeStatus(app, admin.accessToken, diego.uuid, { newStatus, reason: 'Motivo' }).expect(409);
        expect(response.body.errors).toEqual([expect.objectContaining({ code: 'account_deleted' })]);
      }
    });

    it('refuses to set the status the account already has', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'active', reason: 'Motivo' }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'status_unchanged' })]);
    });

    it.each([
      [{ newStatus: 'banned', reason: 'Motivo' }, '/data/attributes/newStatus'],
      [{ reason: 'Motivo' }, '/data/attributes/newStatus'],
      [{ newStatus: 'suspended' }, '/data/attributes/reason'],
      [{ newStatus: 'suspended', reason: '   ' }, '/data/attributes/reason'],
      [{ newStatus: 'suspended', reason: 'x'.repeat(1001) }, '/data/attributes/reason'],
    ])('validates the status and requires a reason (%j)', async (attributes, pointer) => {
      const diego = await registerVerified(app, 'diego_papi');

      const response = await changeStatus(app, admin.accessToken, diego.uuid, attributes).expect(422);

      expect(response.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: { pointer } })]));
      await getMe(app.server, diego.accessToken).expect(200);
    });

    it('answers 404 for an unknown account', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        await changeStatus(app, admin.accessToken, id, { newStatus: 'suspended', reason: 'Motivo' }).expect(404);
      }
    });

    it('refuses to suspend the last active verified administrator, also by themselves', async () => {
      const response = await changeStatus(app, admin.accessToken, admin.uuid, {
        newStatus: 'suspended',
        reason: 'Me suspendo',
      }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'last_administrator' })]);
      await getMe(app.server, admin.accessToken).expect(200);
    });

    it('suspends an administrator while another operational administrator remains', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);

      await changeStatus(app, diego.accessToken, admin.uuid, { newStatus: 'suspended', reason: 'Cuenta comprometida' }).expect(201);

      await getMe(app.server, admin.accessToken).expect(401);
      // The suspended administrator no longer counts, so the remaining one cannot be demoted.
      await changeRole(app, diego.accessToken, diego.uuid, { newRole: 'user', reason: 'Me retiro' }).expect(409);
    });

    it('keeps an operational administrator when two administrators suspend each other at the same time', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);

      const responses = await Promise.all([
        changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Fuera' }),
        changeStatus(app, diego.accessToken, admin.uuid, { newStatus: 'suspended', reason: 'Fuera' }),
      ]);

      // The loser is refused under the lock (403) or, if it arrives after the winner commits, for its ended session (401).
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect([401, 403]).toContain(statuses.find((status) => status !== 201));
      const winner = statuses[0] === 201 ? admin : diego;
      await getMe(app.server, winner.accessToken).expect(200);
    });

    it('keeps an operational administrator when one is suspended while the other is demoted', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Relevo' }).expect(201);

      const responses = await Promise.all([
        changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Fuera' }),
        changeRole(app, admin.accessToken, admin.uuid, { newRole: 'user', reason: 'Me retiro' }),
      ]);

      // Whichever runs second finds the other done: the last administrator (409), or an actor no longer admin (403).
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect([403, 409]).toContain(statuses.find((status) => status !== 201));
      const stillAdministering = await Promise.all(
        [admin, diego].map((account) => listStatusChanges(app, account.accessToken, account.uuid)),
      );
      expect(stillAdministering.map((response) => response.status)).toContain(200);
    });

    it('lets only one of two simultaneous suspensions apply', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      const responses = await Promise.all([
        changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Primera' }),
        changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Segunda' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const audit = await listStatusChanges(app, admin.accessToken, diego.uuid).expect(200);
      expect(audit.body.meta.total).toBe(1);
    });

    it.each(['user', 'moderator'] as const)('answers 403 to a %s', async (role) => {
      const diego = await registerVerified(app, 'diego_papi');
      const otra = await registerVerified(app, 'otra');
      if (role === 'moderator') {
        await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      }

      await changeStatus(app, diego.accessToken, otra.uuid, { newStatus: 'suspended', reason: 'Motivo' }).expect(403);
      await listStatusChanges(app, diego.accessToken, otra.uuid).expect(403);
      await getMe(app.server, otra.accessToken).expect(200);
    });

    it('requires an access token', async () => {
      const diego = await registerVerified(app, 'diego_papi');

      await changeStatus(app, 'not-a-token', diego.uuid, { newStatus: 'suspended', reason: 'Motivo' }).expect(401);
      await listStatusChanges(app, 'not-a-token', diego.uuid).expect(401);
    });
  });

  describe('GET /v1/admin/users/{id}/status-changes', () => {
    it('lists the status changes of the account, newest first', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      app.clock.advance(MINUTE);
      await suspend(diego, 'Spam');
      app.clock.advance(MINUTE);
      await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'active', reason: 'Apelación' }).expect(201);

      const response = await listStatusChanges(app, admin.accessToken, diego.uuid).expect(200);

      expect(response.body.data).toEqual([
        {
          type: 'status-changes',
          id: expect.any(String),
          attributes: {
            previousStatus: 'suspended',
            newStatus: 'active',
            reason: 'Apelación',
            changedAt: '2026-01-01T00:02:00.000Z',
          },
          relationships: {
            user: { data: { type: 'users', id: diego.uuid } },
            changedBy: { data: { type: 'users', id: admin.uuid } },
          },
        },
        expect.objectContaining({
          attributes: { previousStatus: 'active', newStatus: 'suspended', reason: 'Spam', changedAt: '2026-01-01T00:01:00.000Z' },
        }),
      ]);
      expect(response.body.meta).toEqual({ total: 2 });
    });

    it('answers 404 for an unknown account', async () => {
      await listStatusChanges(app, admin.accessToken, '00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('rejects unsupported query parameters', async () => {
      await listStatusChanges(app, admin.accessToken, admin.uuid).query({ 'filter[status]': 'active' }).expect(400);
    });
  });
});
