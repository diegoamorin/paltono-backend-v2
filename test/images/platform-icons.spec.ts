import request from 'supertest';
import { DataSource } from 'typeorm';
import { accessTokenFor } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { TEST_IMAGE_BASE_URL, fetchImage, pngImage, svgIcon, uploadImage, uploadPlatformIcon } from '../support/images';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

describe('platform icon uploads', () => {
  let app: TestApp;
  let admin: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/images/platform-icons', () => {
    it('stores an SVG as a platform icon and serves it so that it can run nothing', async () => {
      const response = await uploadPlatformIcon(app, admin.accessToken, svgIcon('Spotify')).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      expect(response.body.data).toEqual({
        type: 'image-uploads',
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        attributes: {
          purpose: 'platform_icon',
          url: expect.stringMatching(/\.svg$/),
          bytes: expect.any(Number),
          width: 24,
          height: 24,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        relationships: { uploadedBy: { data: { type: 'users', id: admin.uuid } } },
      });
      const { url, bytes } = response.body.data.attributes;
      expect(url.startsWith(TEST_IMAGE_BASE_URL)).toBe(true);

      const served = await fetchImage(app, url).expect(200);
      expect(served.headers['content-type']).toBe('image/svg+xml');
      expect(served.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.body.length).toBe(bytes);
      expect(served.body.toString()).toBe(svgIcon('Spotify').toString());
    });

    it('stores the rebuilt icon, not the uploaded file', async () => {
      const exported = Buffer.from(
        '<?xml version="1.0"?><!-- Figma --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' +
          '<metadata>Made with love</metadata><path d="M0 0h40v20z"/></svg>',
      );

      const { url, width, height } = (await uploadPlatformIcon(app, admin.accessToken, exported).expect(201)).body.data.attributes;

      expect({ width, height }).toEqual({ width: 40, height: 20 });
      expect((await fetchImage(app, url).expect(200)).body.toString()).toBe(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path d="M0 0h40v20z"/></svg>',
      );
    });

    it('names everything to remove from a refused icon, and stores nothing', async () => {
      const unsafe = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>path{fill:red}</style>' +
          '<path style="fill:red" onclick="steal()" d="M0 0z"/><path style="fill:blue" d="M1 1z"/></svg>',
      );

      const response = await uploadPlatformIcon(app, admin.accessToken, unsafe).expect(422);

      expect(response.body.errors).toEqual([
        {
          status: '422',
          title: 'Unprocessable Entity',
          code: 'svg_forbidden_element',
          detail: 'Remove the <style> element; use presentation attributes like fill instead',
          meta: { element: 'style' },
        },
        {
          status: '422',
          title: 'Unprocessable Entity',
          code: 'svg_forbidden_attribute',
          detail: 'Remove the style attribute from <path>; use presentation attributes like fill instead',
          meta: { element: 'path', attribute: 'style' },
        },
        {
          status: '422',
          title: 'Unprocessable Entity',
          code: 'svg_forbidden_attribute',
          detail: 'Remove the onclick attribute from <path>',
          meta: { element: 'path', attribute: 'onclick' },
        },
      ]);
      expect(JSON.stringify(response.body)).not.toContain('steal');
      // No endpoint lists uploads, so the record is looked for in the database.
      expect(await app.app.get(DataSource).query('SELECT id FROM image_uploads')).toEqual([]);
    });

    it('refuses an icon over 64 KB', async () => {
      const heavy = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${'<path d="M0 0z"/>'.repeat(5000)}</svg>`,
      );

      const response = await uploadPlatformIcon(app, admin.accessToken, heavy).expect(413);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'svg_too_large', detail: 'The icon must weigh at most 64 KB' })]);
    });

    it('refuses an icon over the 3 MB of other images as too large an icon', async () => {
      const huge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>${'a'.repeat(3.5 * 1024 * 1024)}</title></svg>`);

      const response = await uploadPlatformIcon(app, admin.accessToken, huge).expect(413);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'svg_too_large' })]);
    });

    it.each([
      ['a PNG', () => pngImage()],
      ['text', async () => Buffer.from('no soy un icono')],
    ])('refuses %s', async (_, file) => {
      const response = await uploadPlatformIcon(app, admin.accessToken, await file(), 'icon.svg').expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'svg_unparseable' })]);
    });

    it('is only for administrators', async () => {
      const diego = await registerVerified(app, 'diego_papi');
      await uploadPlatformIcon(app, diego.accessToken, svgIcon()).expect(403);
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Modera el catálogo' }).expect(201);
      await uploadPlatformIcon(app, await accessTokenFor(app.server, diego.username), svgIcon()).expect(403);
      await request(app.server).post('/v1/images/platform-icons').set('Accept', JSON_API).attach('file', svgIcon(), 'icon.svg').expect(401);
    });

    it('has no quota', async () => {
      for (let i = 0; i < 6; i++) await uploadPlatformIcon(app, admin.accessToken, svgIcon(`icon ${i}`)).expect(201);
    });
  });

  it('keeps SVG out of catalog uploads', async () => {
    const diego = await registerVerified(app, 'diego_papi');

    for (const account of [diego, admin]) {
      const response = await uploadImage(app, account.accessToken, svgIcon(), 'icon.svg').expect(422);
      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'unsupported_image' })]);
    }
  });
});
