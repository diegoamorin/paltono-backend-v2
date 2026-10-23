import sharp from 'sharp';
import { accessTokenFor, getMe, register } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  TEST_IMAGE_BASE_URL,
  fetchImage,
  pngImage,
  uploadAvatar,
  uploadImage,
  uploadedAvatarUrl,
} from '../support/images';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const DAY = 24 * 60 * 60 * 1000;

describe('PUT /v1/me/avatar', () => {
  let app: TestApp;
  let diego: Account;

  /** Moves the clock and logs in again, since access tokens last 15 minutes. */
  async function advance(milliseconds: number, username = 'diego_papi'): Promise<string> {
    app.clock.advance(milliseconds);
    return accessTokenFor(app.server, username);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    diego = await registerVerified(app, 'diego_papi');
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies the uploaded avatar to the own account at once, served by the storage', async () => {
    const response = await uploadAvatar(app, diego.accessToken, await pngImage({ width: 12, height: 12 })).expect(200);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body.data).toEqual(expect.objectContaining({ type: 'users', id: diego.uuid }));
    const { avatarUrl } = response.body.data.attributes;
    expect(avatarUrl).toMatch(new RegExp(`^${TEST_IMAGE_BASE_URL}[0-9a-f-]{36}\\.png$`));
    const me = await getMe(app.server, diego.accessToken).expect(200);
    expect(me.body.data.attributes.avatarUrl).toBe(avatarUrl);

    const served = await fetchImage(app, avatarUrl).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(await sharp(served.body).metadata()).toEqual(expect.objectContaining({ format: 'png', width: 12, height: 12 }));
  });

  it('stops serving the replaced avatar', async () => {
    const first = await uploadedAvatarUrl(app, diego.accessToken);
    const accessToken = await advance(15 * DAY);

    const second = await uploadedAvatarUrl(app, accessToken);

    expect(second).not.toBe(first);
    await fetchImage(app, first).expect(404);
    await fetchImage(app, second).expect(200);
  });

  it('validates the image like a catalog upload, and a rejection keeps the current avatar', async () => {
    const current = await uploadedAvatarUrl(app, diego.accessToken);

    const response = await uploadAvatar(app, diego.accessToken, Buffer.from('not an image'), 'fake.png').expect(422);

    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'unsupported_image' })]);
    const me = await getMe(app.server, diego.accessToken).expect(200);
    expect(me.body.data.attributes.avatarUrl).toBe(current);
    await fetchImage(app, current).expect(200);
  });

  describe('avatar upload quota', () => {
    it('allows one change in 15 days, for every role, and tells when the next will be possible', async () => {
      const admin = await registerFirstAdmin(app);
      const moderator = await registerVerified(app, 'moderadora');
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Equipo' }).expect(201);

      for (const username of ['diego_papi', 'moderadora', 'admin']) {
        const accessToken = await accessTokenFor(app.server, username);
        await uploadAvatar(app, accessToken, await pngImage()).expect(200);
        app.clock.advance(DAY);

        const response = await uploadAvatar(app, await accessTokenFor(app.server, username), await pngImage()).expect(429);

        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'upload_quota_exceeded', meta: { availableAt: expect.any(String) } }),
        ]);
      }
      const response = await uploadAvatar(app, await accessTokenFor(app.server, 'diego_papi'), await pngImage()).expect(429);
      expect(response.body.errors[0].meta.availableAt).toBe('2026-01-16T00:00:00.000Z');
    });

    it('frees up 15 days after the last change', async () => {
      await uploadAvatar(app, diego.accessToken, await pngImage()).expect(200);

      await uploadAvatar(app, await advance(15 * DAY - 1), await pngImage()).expect(429);
      await uploadAvatar(app, await advance(1), await pngImage()).expect(200);
    });

    it('does not count rejected uploads', async () => {
      await uploadAvatar(app, diego.accessToken, Buffer.from('not an image'), 'fake.png').expect(422);

      await uploadAvatar(app, diego.accessToken, await pngImage()).expect(200);
    });

    it('is apart from the catalog upload quota', async () => {
      for (let i = 0; i < 4; i++) await uploadImage(app, diego.accessToken, await pngImage()).expect(201);

      await uploadAvatar(app, diego.accessToken, await pngImage()).expect(200);
      await uploadImage(app, diego.accessToken, await pngImage()).expect(429);
    });

    it('leaves the catalog upload quota untouched', async () => {
      await uploadAvatar(app, diego.accessToken, await pngImage()).expect(200);

      for (let i = 0; i < 4; i++) await uploadImage(app, diego.accessToken, await pngImage()).expect(201);
    });
  });

  it('requires an active account with a verified email', async () => {
    const response = await register(app.server, { username: 'nuevo', email: 'nuevo@example.com' }).expect(201);
    const unverified = await accessTokenFor(app.server, 'nuevo');

    await uploadAvatar(app, unverified, await pngImage()).expect(403);
    await uploadAvatar(app, 'not a token', await pngImage()).expect(401);
    const me = await getMe(app.server, unverified).expect(200);
    expect(me.body.data.id).toBe(response.body.data.id);
    expect(me.body.data.attributes.avatarUrl).toBeNull();
  });
});
