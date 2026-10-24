import { accessTokenFor, getMe, register, requestVerification, sendJsonApi, verifyEmail } from '../support/accounts';
import { TestApp, createTestApp } from '../support/test-app';

const HOUR = 60 * 60 * 1000;

describe('email verification', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      env: { MAIN_APP_URL: 'https://paltono.test' },
    });
  });

  beforeEach(async () => {
    await app.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the email sent on registration', () => {
    it('is in Spanish and links to the main app', async () => {
      await register(app.server).expect(201);

      const [email] = app.mailer.to('diego@example.com', 'email-verification');
      expect(email.subject).toBe('Confirma tu correo en Paltono');
      expect(email.text).toContain('Hola, Diego 🎤');
      expect(email.html).toContain('href="https://paltono.test/verificar-correo?token=');
      const link = app.mailer.lastLink('diego@example.com', 'email-verification');
      expect(link.origin + link.pathname).toBe('https://paltono.test/verificar-correo');
      expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('is not sent when the registration fails', async () => {
      await register(app.server).expect(201);
      app.mailer.clear();

      await register(app.server, { email: 'other@example.com' }).expect(409);

      expect(app.mailer.sent).toEqual([]);
    });

    it('failing to send keeps the account, unverified', async () => {
      app.mailer.failNext();

      const response = await register(app.server).expect(201);

      expect(response.body.data.attributes.emailVerified).toBe(false);
      expect(app.mailer.sent).toEqual([]);
      await register(app.server, { email: 'other@example.com' }).expect(409);
    });
  });

  describe('POST /v1/email-verifications', () => {
    it('verifies the email', async () => {
      await register(app.server).expect(201);
      const token = app.mailer.lastToken('diego@example.com', 'email-verification');

      const response = await verifyEmail(app.server, token).expect(204);

      expect(response.text).toBe('');
      expect(await emailVerified('diego_papi')).toBe(true);
    });

    it('accepts a token until it is 24 hours old', async () => {
      await register(app.server).expect(201);
      const token = app.mailer.lastToken('diego@example.com', 'email-verification');

      app.clock.advance(24 * HOUR - 1);

      await verifyEmail(app.server, token).expect(204);
    });

    it('rejects a token older than 24 hours', async () => {
      await register(app.server).expect(201);
      const token = app.mailer.lastToken('diego@example.com', 'email-verification');

      app.clock.advance(24 * HOUR);

      const response = await verifyEmail(app.server, token).expect(409);
      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'token_expired' })]);
      expect(await emailVerified('diego_papi')).toBe(false);
    });

    it('takes the token lifetime from the configuration', async () => {
      const configured = await createTestApp({ env: { EMAIL_VERIFICATION_TTL_HOURS: '1' } });
      try {
        await configured.reset();
        await register(configured.server).expect(201);
        const token = configured.mailer.lastToken('diego@example.com', 'email-verification');

        configured.clock.advance(HOUR);

        await verifyEmail(configured.server, token).expect(409);
      } finally {
        await configured.close();
      }
    });

    it('accepts a token only once', async () => {
      await register(app.server).expect(201);
      const token = app.mailer.lastToken('diego@example.com', 'email-verification');
      await verifyEmail(app.server, token).expect(204);

      const response = await verifyEmail(app.server, token).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'token_used' })]);
    });

    it('rejects an unknown token', async () => {
      const response = await verifyEmail(app.server, 'x'.repeat(43)).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'token_invalid', source: { pointer: '/data/attributes/token' } }),
      ]);
    });

    it('rejects a missing token', async () => {
      const response = await verifyEmail(app.server, '').expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ source: { pointer: '/data/attributes/token' } }),
      ]);
    });
  });

  describe('POST /v1/email-verification-requests (resend)', () => {
    it('sends a new verification link to the main app', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await requestVerification(app.server, accessToken).expect(202);

      expect(response.text).toBe('');
      const emails = app.mailer.to('diego@example.com', 'email-verification');
      expect(emails).toHaveLength(2);
      expect(emails[1].idempotencyKey).not.toBe(emails[0].idempotencyKey);
      expect(app.mailer.lastLink('diego@example.com', 'email-verification').origin).toBe('https://paltono.test');
    });

    it('rejects an unknown frontend attribute', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      const response = await sendJsonApi(app.server, 'post', '/v1/email-verification-requests', {
        data: { type: 'email-verification-requests', attributes: { frontend: 'main' } },
      })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ source: { pointer: '/data/attributes/frontend' } }),
      ]);
    });

    it('recovers from a failed send on registration', async () => {
      app.mailer.failNext();
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');

      await requestVerification(app.server, accessToken).expect(202);
      await verifyEmail(app.server, app.mailer.lastToken('diego@example.com', 'email-verification')).expect(204);

      expect(await emailVerified('diego_papi')).toBe(true);
    });

    it('answers 202 even when sending fails', async () => {
      await register(app.server).expect(201);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');
      app.mailer.failNext();

      await requestVerification(app.server, accessToken).expect(202);
    });

    it('verifying with any link consumes the others', async () => {
      await register(app.server).expect(201);
      const first = app.mailer.lastToken('diego@example.com', 'email-verification');
      await requestVerification(app.server, await accessTokenFor(app.server, 'diego_papi')).expect(202);
      const second = app.mailer.lastToken('diego@example.com', 'email-verification');

      await verifyEmail(app.server, second).expect(204);

      await verifyEmail(app.server, first).expect(409);
    });

    it('is refused once the email is verified', async () => {
      await register(app.server).expect(201);
      await verifyEmail(app.server, app.mailer.lastToken('diego@example.com', 'email-verification')).expect(204);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');
      app.mailer.clear();

      const response = await requestVerification(app.server, accessToken).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'email_already_verified' })]);
      expect(app.mailer.sent).toEqual([]);
    });

    it('requires an access token', async () => {
      await requestVerification(app.server, 'not-a-token').expect(401);
    });
  });

  /** Observes the verification flag through the account's own view. */
  async function emailVerified(username: string): Promise<boolean> {
    const accessToken = await accessTokenFor(app.server, username);
    const response = await getMe(app.server, accessToken).expect(200);
    return response.body.data.attributes.emailVerified;
  }
});
