import { productionEnv } from '../support/production-env';
import { createTestApp } from '../support/test-app';

/** Each test removes one variable from it. */
const PRODUCTION = productionEnv();

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
