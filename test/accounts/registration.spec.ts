import { register, registration, sendJsonApi } from '../support/accounts';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

describe('POST /v1/users (registration)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an unverified account', async () => {
    const response = await register(app.server).expect(201);

    expect(response.headers['content-type']).toBe(JSON_API);
    expect(response.body).toEqual({
      jsonapi: { version: '1.1' },
      data: {
        type: 'users',
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        attributes: {
          username: 'diego_papi',
          email: 'diego@example.com',
          displayName: 'Diego 🎤',
          avatarUrl: null,
          bio: null,
          emailVerified: false,
          role: 'user',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          usernameChangedAt: '2026-01-01T00:00:00.000Z',
          usernameChangeAvailableAt: '2026-01-08T00:00:00.000Z',
        },
      },
      links: { self: `/v1/users/${response.body.data.id}` },
    });
  });

  describe('username', () => {
    it.each(['a', '_', 'k.pop_fan', 'twice4ever', 'x'.repeat(30)])('accepts %p', async (username) => {
      const response = await register(app.server, { username }).expect(201);

      expect(response.body.data.attributes.username).toBe(username);
    });

    it('is stored in lowercase', async () => {
      const response = await register(app.server, { username: 'Diego_Papi.KR' }).expect(201);

      expect(response.body.data.attributes.username).toBe('diego_papi.kr');
    });

    it.each([
      ['empty', ''],
      ['too long', 'x'.repeat(31)],
      ['ending with a period', 'diego.'],
      ['with a hyphen', 'diego-papi'],
      ['with a space', 'diego papi'],
      ['with an @', 'diego@papi'],
      ['with non-ASCII letters', 'diegó'],
      ['with Hangul', '디에고'],
    ])('is rejected when %s', async (_, username) => {
      const response = await register(app.server, { username }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ status: '422', source: { pointer: '/data/attributes/username' } }),
      ]);
    });
  });

  describe('password', () => {
    it.each([
      ['8 characters with no composition rules', 'aaaaaaaa'],
      ['128 characters', 'p'.repeat(128)],
      ['8 emoji, counted as characters rather than UTF-16 units', '🎤'.repeat(8)],
      ['128 emoji', '🎤'.repeat(128)],
    ])('accepts %s', async (_, password) => {
      await register(app.server, { password }).expect(201);
    });

    it.each([
      ['shorter than 8 characters', 'short12'],
      ['longer than 128 characters', 'p'.repeat(129)],
      ['4 emoji, though they take 8 UTF-16 units', '🎤'.repeat(4)],
    ])('is rejected when %s', async (_, password) => {
      const response = await register(app.server, { password }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ source: { pointer: '/data/attributes/password' } }),
      ]);
    });
  });

  it('rejects an invalid email, a blank display name and a frontend, which clients no longer choose', async () => {
    const response = await register(app.server, { email: 'not-an-email', displayName: '   ', frontend: 'main' }).expect(422);

    const pointers = response.body.errors.map((error: { source: { pointer: string } }) => error.source.pointer);
    expect([...new Set(pointers)].sort()).toEqual([
      '/data/attributes/displayName',
      '/data/attributes/email',
      '/data/attributes/frontend',
    ]);
  });

  it('rejects a document of another type', async () => {
    const response = await sendJsonApi(app.server, 'post', '/v1/users', {
      data: { type: 'sessions', attributes: registration() },
    }).expect(422);

    expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/type' } })]);
  });

  it('rejects query parameters it does not support', async () => {
    const response = await register(app.server).query({ include: 'sessions' }).expect(400);

    expect(response.body.errors).toEqual([expect.objectContaining({ source: { parameter: 'include' } })]);
  });

  it('supports sparse fieldsets on the created account', async () => {
    const response = await register(app.server).query({ 'fields[users]': 'username' }).expect(201);

    expect(response.body.data.attributes).toEqual({ username: 'diego_papi' });
  });

  describe('uniqueness', () => {
    it('rejects a username already taken, whatever its case', async () => {
      await register(app.server).expect(201);

      const response = await register(app.server, { username: 'DIEGO_PAPI', email: 'other@example.com' }).expect(409);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ status: '409', code: 'username_taken', source: { pointer: '/data/attributes/username' } }),
      ]);
    });

    it('rejects an email already taken, whatever its case', async () => {
      await register(app.server).expect(201);

      const response = await register(app.server, { username: 'other', email: 'Diego@Example.COM' }).expect(409);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ status: '409', code: 'email_taken', source: { pointer: '/data/attributes/email' } }),
      ]);
    });

    it('creates only one account from simultaneous registrations', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, index) => register(app.server, { email: `diego${index}@example.com` })),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409]);
    });
  });
});
