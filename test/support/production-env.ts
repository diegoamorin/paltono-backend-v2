/** A complete production environment; tests override or remove (`undefined`) the variables they are about. */
export function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
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
    ...overrides,
  };
}
