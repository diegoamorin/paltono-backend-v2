import { DataSource } from 'typeorm';
import {
  accessTokenFor,
  confirmEmailChange,
  getMe,
  login,
  register,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  sendJsonApi,
  setAccountStatus,
} from '../support/accounts';
import { changeStatus, registerFirstAdmin } from '../support/administration';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('email changes', () => {
  let app: TestApp;
  let accessToken: string;

  beforeAll(async () => {
    app = await createTestApp({
      env: { MAIN_APP_URL: 'https://paltono.test' },
    });
  });

  beforeEach(async () => {
    await app.reset();
    await register(app.server).expect(201);
    accessToken = await accessTokenFor(app.server, 'diego_papi');
    app.mailer.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/me/email-change-requests', () => {
    it('emails a Spanish confirmation link, to the main app, to the new address and keeps the old one until confirmed', async () => {
      const response = await requestEmailChange(app.server, accessToken, { newEmail: '  Nuevo@Example.com ' }).expect(202);

      expect(response.text).toBe('');
      expect(app.mailer.sent.map((email) => email.to)).toEqual(['nuevo@example.com']);
      const [email] = app.mailer.to('nuevo@example.com', 'email-change');
      expect(email.subject).toBe('Confirma tu nuevo correo en Paltono');
      expect(email.text).toContain('Hola, Diego 🎤');
      expect(email.text).toContain('30 minutos');
      const link = app.mailer.lastLink('nuevo@example.com', 'email-change');
      expect(link.origin + link.pathname).toBe('https://paltono.test/confirmar-correo');
      expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const me = await getMe(app.server, accessToken).expect(200);
      expect(me.body.data.attributes.email).toBe('diego@example.com');
    });

    it('requires the current password, sending nothing otherwise', async () => {
      const response = await requestEmailChange(app.server, accessToken, {
        currentPassword: 'wrong password',
        newEmail: 'nuevo@example.com',
      }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'password_incorrect', source: { pointer: '/data/attributes/currentPassword' } }),
      ]);
      expect(app.mailer.sent).toEqual([]);
    });

    it('refuses the current email and an email another account holds', async () => {
      await register(app.server, { username: 'jennie', email: 'Jennie@Example.com' }).expect(201);
      app.mailer.clear();

      const unchanged = await requestEmailChange(app.server, accessToken, { newEmail: 'DIEGO@example.com' }).expect(409);
      const taken = await requestEmailChange(app.server, accessToken, { newEmail: 'jennie@example.com' }).expect(409);

      expect(unchanged.body.errors).toEqual([expect.objectContaining({ code: 'email_unchanged' })]);
      expect(taken.body.errors).toEqual([
        expect.objectContaining({ code: 'email_taken', source: { pointer: '/data/attributes/newEmail' } }),
      ]);
      expect(app.mailer.sent).toEqual([]);
    });

    it('validates the body and rejects a frontend, which clients no longer choose', async () => {
      const response = await sendJsonApi(app.server, 'post', '/v1/me/email-change-requests', {
        data: { type: 'email-change-requests', attributes: { newEmail: 'not an email', frontend: 'main' } },
      })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);

      const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
      expect([...new Set(pointers)].sort()).toEqual([
        '/data/attributes/currentPassword',
        '/data/attributes/frontend',
        '/data/attributes/newEmail',
      ]);
    });

    it('requires authentication', async () => {
      await requestEmailChange(app.server, 'not a token', { newEmail: 'nuevo@example.com' }).expect(401);
    });

    it('answers 202 even when sending fails, and can be asked again', async () => {
      app.mailer.failNext();

      await requestEmailChange(app.server, accessToken, { newEmail: 'nuevo@example.com' }).expect(202);
      await requestEmailChange(app.server, accessToken, { newEmail: 'nuevo@example.com' }).expect(202);

      expect(app.mailer.to('nuevo@example.com', 'email-change')).toHaveLength(1);
    });
  });

  describe('POST /v1/email-changes', () => {
    async function changeToken(newEmail = 'nuevo@example.com', token = accessToken): Promise<string> {
      await requestEmailChange(app.server, token, { newEmail }).expect(202);
      return app.mailer.lastToken(newEmail, 'email-change');
    }

    it('replaces the email and verifies it, since the link proves control of the mailbox', async () => {
      const token = await changeToken();

      const response = await confirmEmailChange(app.server, token).expect(204);

      expect(response.text).toBe('');
      const me = await getMe(app.server, accessToken).expect(200);
      expect(me.body.data.attributes).toEqual(
        expect.objectContaining({ email: 'nuevo@example.com', emailVerified: true }),
      );
      await login(app.server, { identifier: 'Nuevo@example.com' }).expect(201);
      await login(app.server, { identifier: 'diego@example.com' }).expect(401);
    });

    it('frees the old email for a new account', async () => {
      await confirmEmailChange(app.server, await changeToken()).expect(204);

      await register(app.server, { username: 'otra', email: 'diego@example.com' }).expect(201);
    });

    it('uses a token once', async () => {
      const token = await changeToken();
      await confirmEmailChange(app.server, token).expect(204);

      const response = await confirmEmailChange(app.server, token).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'token_used' })]);
    });

    it('refuses a token after 30 minutes, keeping the old email', async () => {
      const token = await changeToken();
      app.clock.advance(30 * MINUTE);

      const response = await confirmEmailChange(app.server, token).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'token_expired' })]);
      await login(app.server, { identifier: 'diego@example.com' }).expect(201);
    });

    it('refuses an unknown token or one of another purpose', async () => {
      await requestPasswordReset(app.server, 'diego@example.com').expect(202);
      const resetToken = app.mailer.lastToken('diego@example.com', 'password-reset');

      for (const token of ['unknown', resetToken]) {
        const response = await confirmEmailChange(app.server, token).expect(422);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'token_invalid', source: { pointer: '/data/attributes/token' } }),
        ]);
      }
    });

    it('rechecks that the email is free, in case another account took it meanwhile', async () => {
      const token = await changeToken();
      await register(app.server, { username: 'jennie', email: 'NUEVO@example.com' }).expect(201);

      const response = await confirmEmailChange(app.server, token).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'email_taken' })]);
      const me = await getMe(app.server, accessToken).expect(200);
      expect(me.body.data.attributes.email).toBe('diego@example.com');
    });

    it('confirms only the latest address requested', async () => {
      const first = await changeToken('primero@example.com');
      const second = await changeToken('segundo@example.com');

      await confirmEmailChange(app.server, first).expect(409);
      await confirmEmailChange(app.server, second).expect(204);
    });

    it('ends the other pending changes and the reset links sent to the old address', async () => {
      await requestPasswordReset(app.server, 'diego@example.com').expect(202);
      const resetToken = app.mailer.lastToken('diego@example.com', 'password-reset');

      await confirmEmailChange(app.server, await changeToken()).expect(204);

      await resetPassword(app.server, resetToken, 'a brand new passphrase').expect(409);
    });

    it('gives an email to only one of two accounts confirming it at once', async () => {
      await register(app.server, { username: 'jennie', email: 'jennie@example.com' }).expect(201);
      const jennieAccess = await accessTokenFor(app.server, 'jennie');
      const diegoToken = await changeToken('lisa@example.com');
      const jennieToken = await changeToken('lisa@example.com', jennieAccess);

      const responses = await Promise.all([
        confirmEmailChange(app.server, diegoToken),
        confirmEmailChange(app.server, jennieToken),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    });

    it('refuses the token of an account suspended since, which keeps its email', async () => {
      const token = await changeToken();
      const admin = await registerFirstAdmin(app);
      await changeStatus(app, admin.accessToken, (await getMe(app.server, accessToken)).body.data.id, {
        newStatus: 'suspended',
        reason: 'Spam',
      }).expect(201);

      const response = await confirmEmailChange(app.server, token).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'account_suspended' })]);
      await register(app.server, { username: 'otra', email: 'diego@example.com' }).expect(409);
    });

    it('refuses the token of an account deleted since', async () => {
      const token = await changeToken();
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'deleted');

      await confirmEmailChange(app.server, token).expect(422);
    });
  });
});

