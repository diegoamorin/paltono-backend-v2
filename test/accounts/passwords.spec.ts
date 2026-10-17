import { DataSource } from 'typeorm';
import {
  DEFAULT_PASSWORD,
  accessTokenFor,
  changePassword,
  getMe,
  login,
  refreshSession,
  register,
  requestPasswordReset,
  resetPassword,
  setAccountStatus,
} from '../support/accounts';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;
const NEW_PASSWORD = 'a brand new passphrase';

describe('passwords', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      env: { FRONTEND_URL_KPOP: 'https://kpop.paltono.test', FRONTEND_URL_MAIN: 'https://paltono.test' },
    });
  });

  beforeEach(async () => {
    await app.reset();
    await register(app.server).expect(201);
    app.mailer.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Logs in as mobile and returns both tokens. */
  async function openSession(password = DEFAULT_PASSWORD) {
    const response = await login(app.server, { identifier: 'diego_papi', password }).expect(201);
    return response.body.meta as { accessToken: string; refreshToken: string };
  }

  describe('POST /v1/password-reset-requests', () => {
    it('emails a Spanish reset link to the kpop frontend by default', async () => {
      const response = await requestPasswordReset(app.server, 'Diego@Example.com').expect(202);

      expect(response.text).toBe('');
      const [email] = app.mailer.to('diego@example.com', 'password-reset');
      expect(email.subject).toBe('Recupera tu contraseña de Paltono');
      expect(email.text).toContain('Hola, Diego 🎤');
      expect(email.text).toContain('30 minutos');
      const link = app.mailer.lastLink('diego@example.com', 'password-reset');
      expect(link.origin + link.pathname).toBe('https://kpop.paltono.test/restablecer-contrasena');
      expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('links to the frontend the client names', async () => {
      await requestPasswordReset(app.server, 'diego@example.com', 'main').expect(202);

      expect(app.mailer.lastLink('diego@example.com', 'password-reset').origin).toBe('https://paltono.test');
    });

    it('answers an unknown or deleted account exactly as an existing one, without sending anything', async () => {
      await register(app.server, { username: 'gone', email: 'gone@example.com' }).expect(201);
      await setAccountStatus(app.app.get(DataSource), 'gone', 'deleted');
      app.mailer.clear();

      const existing = await requestPasswordReset(app.server, 'diego@example.com').expect(202);
      const unknown = await requestPasswordReset(app.server, 'nobody@example.com').expect(202);
      const deleted = await requestPasswordReset(app.server, 'gone@example.com').expect(202);

      for (const response of [unknown, deleted]) {
        expect(response.text).toBe(existing.text);
        expect(response.headers['content-type']).toBe(existing.headers['content-type']);
      }
      expect(app.mailer.sent.map((email) => email.to)).toEqual(['diego@example.com']);
    });

    it('answers 202 even when sending fails', async () => {
      app.mailer.failNext();

      await requestPasswordReset(app.server, 'diego@example.com').expect(202);
    });

    it('validates the body', async () => {
      const response = await requestPasswordReset(app.server, 'not an email', 'https://evil.example').expect(422);

      const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
      expect([...new Set(pointers)].sort()).toEqual(['/data/attributes/email', '/data/attributes/frontend']);
    });
  });

  describe('POST /v1/password-resets', () => {
    async function resetToken(): Promise<string> {
      await requestPasswordReset(app.server, 'diego@example.com').expect(202);
      return app.mailer.lastToken('diego@example.com', 'password-reset');
    }

    it('sets the new password, so only it logs in', async () => {
      const token = await resetToken();

      const response = await resetPassword(app.server, token, NEW_PASSWORD).expect(204);

      expect(response.text).toBe('');
      await login(app.server, { identifier: 'diego_papi', password: NEW_PASSWORD }).expect(201);
      await login(app.server, { identifier: 'diego_papi' }).expect(401);
    });

    it('verifies the email, since the link proves control of the mailbox', async () => {
      const token = await resetToken();

      await resetPassword(app.server, token, NEW_PASSWORD).expect(204);

      const accessToken = await accessTokenFor(app.server, 'diego_papi', NEW_PASSWORD);
      const me = await getMe(app.server, accessToken).expect(200);
      expect(me.body.data.attributes.emailVerified).toBe(true);
    });

    it('revokes every existing session, access and refresh tokens alike', async () => {
      const phone = await openSession();
      const laptop = await openSession();
      const token = await resetToken();

      await resetPassword(app.server, token, NEW_PASSWORD).expect(204);

      for (const session of [phone, laptop]) {
        await getMe(app.server, session.accessToken).expect(401);
        await refreshSession(app.server, { refreshToken: session.refreshToken }).expect(401);
      }
    });

    it('accepts a token until it is 30 minutes old', async () => {
      const token = await resetToken();
      app.clock.advance(30 * MINUTE - 1);

      await resetPassword(app.server, token, NEW_PASSWORD).expect(204);
    });

    it('rejects a token 30 minutes old, keeping the old password', async () => {
      const token = await resetToken();
      app.clock.advance(30 * MINUTE);

      const response = await resetPassword(app.server, token, NEW_PASSWORD).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'token_expired' })]);
      await login(app.server, { identifier: 'diego_papi' }).expect(201);
    });

    it('accepts a token only once, and consumes the other pending reset links', async () => {
      const first = await resetToken();
      const second = await resetToken();
      await resetPassword(app.server, second, NEW_PASSWORD).expect(204);

      const reused = await resetPassword(app.server, second, 'yet another passphrase').expect(409);
      const other = await resetPassword(app.server, first, 'yet another passphrase').expect(409);

      expect(reused.body.errors).toEqual([expect.objectContaining({ code: 'token_used' })]);
      expect(other.body.errors).toEqual([expect.objectContaining({ code: 'token_used' })]);
      await login(app.server, { identifier: 'diego_papi', password: NEW_PASSWORD }).expect(201);
    });

    it('lets only one of two simultaneous resets with the same token succeed', async () => {
      const token = await resetToken();

      const responses = await Promise.all([
        resetPassword(app.server, token, NEW_PASSWORD),
        resetPassword(app.server, token, 'yet another passphrase'),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    });

    it('rejects an unknown token, or a token of another purpose', async () => {
      await register(app.server, { username: 'other', email: 'other@example.com' }).expect(201);
      const verification = app.mailer.lastToken('other@example.com', 'email-verification');

      for (const token of ['x'.repeat(43), verification]) {
        const response = await resetPassword(app.server, token, NEW_PASSWORD).expect(422);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'token_invalid', source: { pointer: '/data/attributes/token' } }),
        ]);
      }
    });

    it('rejects the token of an account deleted since', async () => {
      const token = await resetToken();
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'deleted');

      await resetPassword(app.server, token, NEW_PASSWORD).expect(422);
    });

    it('validates the new password', async () => {
      const token = await resetToken();

      const tooShort = await resetPassword(app.server, token, 'short').expect(422);
      await resetPassword(app.server, token, 'x'.repeat(129)).expect(422);

      expect(tooShort.body.errors).toEqual([
        expect.objectContaining({ source: { pointer: '/data/attributes/password' } }),
      ]);
      await resetPassword(app.server, token, NEW_PASSWORD).expect(204);
    });
  });

  describe('POST /v1/me/password-changes', () => {
    it('sets the new password and revokes every session, the current one included', async () => {
      const current = await openSession();
      const other = await openSession();

      const response = await changePassword(app.server, current.accessToken, DEFAULT_PASSWORD, NEW_PASSWORD).expect(204);

      expect(response.text).toBe('');
      for (const session of [current, other]) {
        await getMe(app.server, session.accessToken).expect(401);
        await refreshSession(app.server, { refreshToken: session.refreshToken }).expect(401);
      }
      await login(app.server, { identifier: 'diego_papi' }).expect(401);
      await login(app.server, { identifier: 'diego_papi', password: NEW_PASSWORD }).expect(201);
    });

    it('clears the refresh token cookie', async () => {
      const current = await openSession();

      const response = await changePassword(app.server, current.accessToken, DEFAULT_PASSWORD, NEW_PASSWORD).expect(204);

      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^paltono_refresh_token=;/);
    });

    it('requires the current password, and changes nothing without it', async () => {
      const current = await openSession();

      const response = await changePassword(app.server, current.accessToken, 'wrong password', NEW_PASSWORD).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'password_incorrect', source: { pointer: '/data/attributes/currentPassword' } }),
      ]);
      await getMe(app.server, current.accessToken).expect(200);
      await login(app.server, { identifier: 'diego_papi' }).expect(201);
    });

    it('invalidates pending reset links', async () => {
      const current = await openSession();
      await requestPasswordReset(app.server, 'diego@example.com').expect(202);
      const token = app.mailer.lastToken('diego@example.com', 'password-reset');

      await changePassword(app.server, current.accessToken, DEFAULT_PASSWORD, NEW_PASSWORD).expect(204);

      await resetPassword(app.server, token, 'yet another passphrase').expect(409);
    });

    it('validates the new password', async () => {
      const current = await openSession();

      const response = await changePassword(app.server, current.accessToken, DEFAULT_PASSWORD, 'short').expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ source: { pointer: '/data/attributes/newPassword' } }),
      ]);
    });

    it('requires an access token', async () => {
      await changePassword(app.server, 'not-a-token', DEFAULT_PASSWORD, NEW_PASSWORD).expect(401);
    });
  });
});
