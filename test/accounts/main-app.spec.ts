import request from 'supertest';
import { register } from '../support/accounts';
import { TestApp, createTestApp } from '../support/test-app';

/** A complete production environment but for `MAIN_APP_URL`. */
const PRODUCTION: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'production-secret',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'Paltono <no-reply@paltono.com>',
  IMAGE_PUBLIC_BASE_URL: 'https://img.paltono.com/',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'paltono-images',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  MAIN_APP_URL: undefined,
};

describe('the main app', () => {
  describe('configuration', () => {
    it('is required in production', async () => {
      await expect(createTestApp({ env: PRODUCTION })).rejects.toThrow('Missing required environment variable MAIN_APP_URL');
    });

    it('is the local main app by default outside production', async () => {
      const app = await createTestApp({ env: { MAIN_APP_URL: undefined } });
      try {
        await register(app.server).expect(201);

        expect(app.mailer.lastLink('diego@example.com', 'email-verification').origin).toBe('http://localhost:5173');
      } finally {
        await app.close();
      }
    });
  });

  describe('with a trailing slash in MAIN_APP_URL', () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await createTestApp({ env: { MAIN_APP_URL: 'https://paltono.test/' } });
    });

    beforeEach(async () => {
      await app.reset();
    });

    afterAll(async () => {
      await app.close();
    });

    it('links emails to the main app', async () => {
      await register(app.server).expect(201);

      const link = app.mailer.lastLink('diego@example.com', 'email-verification');
      expect(link.origin + link.pathname).toBe('https://paltono.test/verificar-correo');
    });

    it('lets the main app read through CORS, with credentials', async () => {
      const response = await request(app.server).get('/v1/countries').set('Origin', 'https://paltono.test').expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('https://paltono.test');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('lets the main app send authenticated JSON:API writes through CORS', async () => {
      const response = await request(app.server)
        .options('/v1/me')
        .set('Origin', 'https://paltono.test')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization, content-type')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('https://paltono.test');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain('PATCH');
      expect(response.headers['access-control-allow-headers']?.toLowerCase()).toEqual(
        expect.stringContaining('authorization'),
      );
    });

    it.each(['https://evil.example', 'https://alturas.paltono.test'])('does not let %s in through CORS', async (origin) => {
      const response = await request(app.server).get('/v1/countries').set('Origin', origin).expect(200);

      // Without an allowed origin the browser blocks the response, whatever else the headers say.
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
