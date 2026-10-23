import {
  DEFAULT_PASSWORD,
  accessTokenFor,
  deleteAccount,
  getMe,
  login,
  refreshSession,
  register,
  requestPasswordReset,
  resetPassword,
  updateProfile,
  verifyEmail,
} from '../support/accounts';
import {
  Account,
  changeRole,
  changeStatus,
  getAccount,
  listStatusChanges,
  registerFirstAdmin,
  registerVerified,
} from '../support/administration';
import { fetchImage, uploadedAvatarUrl, uploadedImageUrl } from '../support/images';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('POST /v1/account-deletions', () => {
  let app: TestApp;
  let admin: Account;
  let diego: Account;
  let avatarUrl: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    diego = await registerVerified(app, 'diego_papi');
    await updateProfile(app.server, diego.accessToken, diego.uuid, { displayName: 'Diego 🎤', bio: 'Fan de BLACKPINK' }).expect(
      200,
    );
    avatarUrl = await uploadedAvatarUrl(app, diego.accessToken);
  });

  afterAll(async () => {
    await app.close();
  });

  it('removes the personal data, keeps the username reserved as display name and audits it with the account as actor', async () => {
    app.clock.advance(MINUTE);
    const accessToken = await accessTokenFor(app.server, 'diego_papi');

    const response = await deleteAccount(app.server, accessToken).expect(204);

    expect(response.text).toBe('');
    const [cookie] = response.headers['set-cookie'] as unknown as string[];
    expect(cookie).toMatch(/^paltono_refresh_token=;/);
    const account = await getAccount(app, admin.accessToken, diego.uuid).expect(200);
    expect(account.body.data.attributes).toEqual(
      expect.objectContaining({
        username: 'diego_papi',
        email: null,
        displayName: 'diego_papi',
        avatarUrl: null,
        bio: null,
        status: 'deleted',
      }),
    );
    const audit = await listStatusChanges(app, admin.accessToken, diego.uuid).expect(200);
    expect(audit.body.data).toEqual([
      expect.objectContaining({
        attributes: {
          previousStatus: 'active',
          newStatus: 'deleted',
          reason: null,
          changedAt: '2026-01-01T00:01:00.000Z',
        },
        relationships: {
          user: { data: { type: 'users', id: diego.uuid } },
          changedBy: { data: { type: 'users', id: diego.uuid } },
        },
      }),
    ]);
  });

  it('stops serving the avatar but keeps serving the catalog images the account uploaded', async () => {
    const catalogImage = await uploadedImageUrl(app, diego.accessToken);

    await deleteAccount(app.server, diego.accessToken).expect(204);

    await fetchImage(app, avatarUrl).expect(404);
    await fetchImage(app, catalogImage).expect(200);
  });

  it('stops serving the avatar of a suspended account an administrator deletes', async () => {
    await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'suspended', reason: 'Spam' }).expect(201);

    await changeStatus(app, admin.accessToken, diego.uuid, { newStatus: 'deleted', reason: 'Lo pidió' }).expect(201);

    await fetchImage(app, avatarUrl).expect(404);
  });

  it('ends every session and pending token, so nothing logs in or acts any more', async () => {
    const mobile = (await login(app.server, { identifier: 'diego_papi' }).expect(201)).body.meta;
    await requestPasswordReset(app.server, 'diego_papi@example.com').expect(202);
    const pendingReset = app.mailer.lastToken('diego_papi@example.com', 'password-reset');

    await deleteAccount(app.server, diego.accessToken).expect(204);

    await getMe(app.server, diego.accessToken).expect(401);
    await getMe(app.server, mobile.accessToken).expect(401);
    await refreshSession(app.server, { refreshToken: mobile.refreshToken }).expect(401);
    await resetPassword(app.server, pendingReset, 'a brand new passphrase').expect(422);
    for (const identifier of ['diego_papi', 'diego_papi@example.com']) {
      await login(app.server, { identifier }).expect(401);
    }
  });

  it('frees the email for a new account that inherits nothing, which no old token reaches', async () => {
    await requestPasswordReset(app.server, 'diego_papi@example.com').expect(202);
    const oldReset = app.mailer.lastToken('diego_papi@example.com', 'password-reset');
    await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Colabora mucho' }).expect(201);
    await deleteAccount(app.server, await accessTokenFor(app.server, 'diego_papi')).expect(204);

    const registered = await register(app.server, { username: 'diego_nuevo', email: 'diego_papi@example.com' }).expect(201);
    await resetPassword(app.server, oldReset, 'a brand new passphrase').expect(422);
    await verifyEmail(app.server, app.mailer.lastToken('diego_papi@example.com', 'email-verification')).expect(204);

    expect(registered.body.data.id).not.toBe(diego.uuid);
    const me = await getMe(app.server, await accessTokenFor(app.server, 'diego_papi@example.com')).expect(200);
    expect(me.body.data.attributes).toEqual(
      expect.objectContaining({ username: 'diego_nuevo', role: 'user', avatarUrl: null, bio: null }),
    );
    await login(app.server, { identifier: 'diego_nuevo', password: 'a brand new passphrase' }).expect(401);
  });

  it('keeps the username reserved', async () => {
    await deleteAccount(app.server, diego.accessToken).expect(204);

    const response = await register(app.server, { username: 'diego_papi', email: 'otro@example.com' }).expect(409);

    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'username_taken' })]);
  });

  it('requires the password, changing nothing without it', async () => {
    const response = await deleteAccount(app.server, diego.accessToken, 'wrong password').expect(422);

    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'password_incorrect', source: { pointer: '/data/attributes/password' } }),
    ]);
    await getMe(app.server, diego.accessToken).expect(200);
  });

  it('validates the body', async () => {
    const response = await deleteAccount(app.server, diego.accessToken, '').expect(422);

    expect(response.body.errors[0].source.pointer).toBe('/data/attributes/password');
  });

  it('requires a verified email', async () => {
    await register(app.server, { username: 'nuevo', email: 'nuevo@example.com' }).expect(201);

    await deleteAccount(app.server, await accessTokenFor(app.server, 'nuevo')).expect(403);
    await deleteAccount(app.server, 'not a token').expect(401);
  });

  it('refuses to delete the last operational administrator, rolling everything back', async () => {
    const response = await deleteAccount(app.server, admin.accessToken).expect(409);

    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'last_administrator' })]);
    const account = await getAccount(app, admin.accessToken, admin.uuid).expect(200);
    expect(account.body.data.attributes).toEqual(
      expect.objectContaining({ status: 'active', email: 'admin@example.com' }),
    );
    await login(app.server, { identifier: 'admin', password: DEFAULT_PASSWORD }).expect(201);
    const audit = await listStatusChanges(app, admin.accessToken, admin.uuid).expect(200);
    expect(audit.body.data).toEqual([]);
  });

  it('lets an administrator go while another one remains', async () => {
    await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Segundo administrador' }).expect(201);

    await deleteAccount(app.server, admin.accessToken).expect(204);
  });

  it('lets only one of the last two administrators leave when both try at once', async () => {
    await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'admin', reason: 'Segundo administrador' }).expect(201);

    const responses = await Promise.all([
      deleteAccount(app.server, admin.accessToken),
      deleteAccount(app.server, diego.accessToken),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
  });
});

