import { accessTokenFor, deleteAccount, getMe, login, register, updateProfile } from '../support/accounts';
import { Account, registerVerified } from '../support/administration';
import { fetchImage, uploadedAvatarUrl, uploadedImageUrl } from '../support/images';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

describe('PATCH /v1/me', () => {
  let app: TestApp;
  let diego: Account;

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

  it('edits the display name and bio and returns the own account', async () => {
    const response = await updateProfile(app.server, diego.accessToken, diego.uuid, {
      displayName: '  디에고 Ñandú  ',
      bio: 'Fan de BLACKPINK',
    }).expect(200);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        type: 'users',
        id: diego.uuid,
        attributes: expect.objectContaining({
          username: 'diego_papi',
          email: 'diego_papi@example.com',
          displayName: '디에고 Ñandú',
          avatarUrl: null,
          bio: 'Fan de BLACKPINK',
        }),
      }),
    );
    const me = await getMe(app.server, diego.accessToken).expect(200);
    expect(me.body.data.attributes).toEqual(response.body.data.attributes);
  });

  it('keeps absent attributes and clears the avatar and the bio with null or an empty bio', async () => {
    const avatarUrl = await uploadedAvatarUrl(app, diego.accessToken);
    await updateProfile(app.server, diego.accessToken, diego.uuid, { bio: 'Fan' }).expect(200);

    const untouched = await updateProfile(app.server, diego.accessToken, diego.uuid, {}).expect(200);
    expect(untouched.body.data.attributes).toEqual(expect.objectContaining({ avatarUrl, bio: 'Fan' }));

    const cleared = await updateProfile(app.server, diego.accessToken, diego.uuid, { avatarUrl: null, bio: '  ' }).expect(200);
    expect(cleared.body.data.attributes).toEqual(
      expect.objectContaining({ displayName: 'Diego 🎤', avatarUrl: null, bio: null }),
    );
  });

  it('stops serving the avatar it clears', async () => {
    const avatarUrl = await uploadedAvatarUrl(app, diego.accessToken);

    await updateProfile(app.server, diego.accessToken, diego.uuid, { avatarUrl: null }).expect(200);

    await fetchImage(app, avatarUrl).expect(404);
  });

  it('refuses an avatar URL, even one uploaded, since avatars are uploaded with PUT /v1/me/avatar', async () => {
    const avatarUrl = await uploadedAvatarUrl(app, diego.accessToken);
    const catalogImage = await uploadedImageUrl(app, diego.accessToken);

    for (const url of ['https://cdn.example.com/diego.png', avatarUrl, catalogImage]) {
      const response = await updateProfile(app.server, diego.accessToken, diego.uuid, { avatarUrl: url }).expect(422);
      expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/attributes/avatarUrl' } })]);
    }
    const me = await getMe(app.server, diego.accessToken).expect(200);
    expect(me.body.data.attributes.avatarUrl).toBe(avatarUrl);
    await fetchImage(app, avatarUrl).expect(200);
  });

  it('validates the attributes', async () => {
    const response = await updateProfile(app.server, diego.accessToken, diego.uuid, {
      displayName: '   ',
      avatarUrl: 'javascript:alert(1)',
      bio: 'x'.repeat(1001),
      email: 'other@example.com',
    }).expect(422);

    const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
    expect([...new Set(pointers)].sort()).toEqual([
      '/data/attributes/avatarUrl',
      '/data/attributes/bio',
      '/data/attributes/displayName',
      '/data/attributes/email',
    ]);
  });

  it('refuses a null display name or any avatar but null', async () => {
    for (const attributes of [{ displayName: null }, { avatarUrl: 'ftp://cdn.example.com/a.png' }]) {
      await updateProfile(app.server, diego.accessToken, diego.uuid, attributes).expect(422);
    }
  });

  it('refuses a document naming another account', async () => {
    const other = await registerVerified(app, 'jennie');

    const response = await updateProfile(app.server, diego.accessToken, other.uuid, { bio: 'Hola' }).expect(409);

    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'id_mismatch' })]);
    const me = await getMe(app.server, other.accessToken).expect(200);
    expect(me.body.data.attributes.bio).toBeNull();
  });

  it('requires a verified email', async () => {
    const response = await register(app.server, { username: 'nuevo', email: 'nuevo@example.com' }).expect(201);
    const accessToken = await accessTokenFor(app.server, 'nuevo');

    await updateProfile(app.server, accessToken, response.body.data.id, { bio: 'Hola' }).expect(403);
    await updateProfile(app.server, 'not a token', diego.uuid, { bio: 'Hola' }).expect(401);
  });

  describe('username', () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** Moves the clock and logs in again, since access tokens last 15 minutes. */
    async function advance(milliseconds: number, username = 'diego_papi'): Promise<string> {
      app.clock.advance(milliseconds);
      return accessTokenFor(app.server, username);
    }

    it('changes once 7 full days have passed since it was assigned, freeing the old one at once', async () => {
      const accessToken = await advance(7 * DAY);

      const response = await updateProfile(app.server, accessToken, diego.uuid, { username: 'Dieguito' }).expect(200);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({
          username: 'dieguito',
          usernameChangedAt: '2026-01-08T00:00:00.000Z',
          usernameChangeAvailableAt: '2026-01-15T00:00:00.000Z',
        }),
      );
      await login(app.server, { identifier: 'dieguito' }).expect(201);
      await login(app.server, { identifier: 'diego_papi' }).expect(401);
      await register(app.server, { username: 'diego_papi', email: 'otro@example.com' }).expect(201);
    });

    it('refuses a change before 7 full days, changing nothing else either', async () => {
      const accessToken = await advance(7 * DAY - 1);

      const response = await updateProfile(app.server, accessToken, diego.uuid, {
        username: 'dieguito',
        bio: 'Hola',
      }).expect(409);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'username_change_too_soon', source: { pointer: '/data/attributes/username' } }),
      ]);
      const me = await getMe(app.server, accessToken).expect(200);
      expect(me.body.data.attributes).toEqual(expect.objectContaining({ username: 'diego_papi', bio: null }));
    });

    it('counts the interval from the last change', async () => {
      await updateProfile(app.server, await advance(7 * DAY), diego.uuid, { username: 'dieguito' }).expect(200);

      await updateProfile(app.server, await advance(6 * DAY, 'dieguito'), diego.uuid, { username: 'diego' }).expect(409);
      await updateProfile(app.server, await advance(DAY, 'dieguito'), diego.uuid, { username: 'diego' }).expect(200);
    });

    it('treats the same normalized username as a no-op that neither fails nor restarts the interval', async () => {
      const accessToken = await advance(DAY);

      const response = await updateProfile(app.server, accessToken, diego.uuid, { username: 'DIEGO_PAPI' }).expect(200);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({ username: 'diego_papi', usernameChangedAt: '2026-01-01T00:00:00.000Z' }),
      );
    });

    it('refuses a username in use, also the one a deleted account keeps reserved', async () => {
      await registerVerified(app, 'jennie');
      const gone = await registerVerified(app, 'gone');
      await deleteAccount(app.server, gone.accessToken).expect(204);
      const accessToken = await advance(7 * DAY);

      for (const username of ['jennie', 'gone']) {
        const response = await updateProfile(app.server, accessToken, diego.uuid, { username }).expect(409);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'username_taken', source: { pointer: '/data/attributes/username' } }),
        ]);
      }
    });

    it('validates the format', async () => {
      const accessToken = await advance(7 * DAY);

      for (const username of ['', 'diego.', 'diego-papi', 'a'.repeat(31), null]) {
        const response = await updateProfile(app.server, accessToken, diego.uuid, { username }).expect(422);
        expect(response.body.errors[0].source.pointer).toBe('/data/attributes/username');
      }
    });

    it('lets only one of two simultaneous changes through', async () => {
      const accessToken = await advance(7 * DAY);

      const responses = await Promise.all([
        updateProfile(app.server, accessToken, diego.uuid, { username: 'primero' }),
        updateProfile(app.server, accessToken, diego.uuid, { username: 'segundo' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const me = await getMe(app.server, accessToken).expect(200);
      expect(['primero', 'segundo']).toContain(me.body.data.attributes.username);
    });

    it('gives a username to only one of two accounts claiming it at once', async () => {
      const jennie = await registerVerified(app, 'jennie');
      const diegoToken = await advance(7 * DAY);
      const jennieToken = await accessTokenFor(app.server, 'jennie');

      const responses = await Promise.all([
        updateProfile(app.server, diegoToken, diego.uuid, { username: 'lisa' }),
        updateProfile(app.server, jennieToken, jennie.uuid, { username: 'lisa' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    });
  });
});
