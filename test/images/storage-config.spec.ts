import { createTestApp } from '../support/test-app';

/** A complete production environment; each test removes one variable from it. */
const PRODUCTION: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'production-secret',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'Paltono <no-reply@paltono.com>',
  MAIN_APP_URL: 'https://paltono.com',
  IMAGE_PUBLIC_BASE_URL: 'https://img.paltono.com/',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'paltono-images',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
};

describe('image storage configuration in production', () => {
  it('starts with the public base URL and the R2 configuration', async () => {
    const app = await createTestApp({ env: PRODUCTION });
    await app.close();
  });

  it.each(['IMAGE_PUBLIC_BASE_URL', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])(
    'refuses to start without %s',
    async (name) => {
      await expect(createTestApp({ env: { ...PRODUCTION, [name]: undefined } })).rejects.toThrow(
        `Missing required environment variable ${name}`,
      );
    },
  );
});
