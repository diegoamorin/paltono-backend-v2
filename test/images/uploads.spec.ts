import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { accessTokenFor, register, setAccountStatus } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  TEST_IMAGE_BASE_URL,
  fetchImage,
  jpegImage,
  noiseImage,
  pngImage,
  uploadImage,
  uploadedImageUrl,
  webpImage,
} from '../support/images';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const DAY = 24 * 60 * 60 * 1000;

describe('image uploads', () => {
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

  describe('POST /v1/images', () => {
    it('stores a PNG as a catalog upload and answers its public URL, which serves the image', async () => {
      const response = await uploadImage(app, diego.accessToken, await pngImage({ width: 20, height: 10 })).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      const { attributes } = response.body.data;
      expect(response.body.data).toEqual({
        type: 'image-uploads',
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        attributes: {
          purpose: 'catalog',
          url: expect.stringMatching(/\.png$/),
          bytes: expect.any(Number),
          width: 20,
          height: 10,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        relationships: { uploadedBy: { data: { type: 'users', id: diego.uuid } } },
      });
      expect(attributes.url.startsWith(TEST_IMAGE_BASE_URL)).toBe(true);

      const served = await fetchImage(app, attributes.url).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.body.length).toBe(attributes.bytes);
      expect(await sharp(served.body).metadata()).toEqual(expect.objectContaining({ format: 'png', width: 20, height: 10 }));
    });

    it.each([
      ['JPEG', jpegImage, 'jpeg', 'image/jpeg', /\.jpg$/],
      ['WebP', webpImage, 'webp', 'image/webp', /\.webp$/],
    ])('keeps a %s in its format', async (_, image, format, contentType, extension) => {
      // Named .png on purpose: the format comes from the content.
      const response = await uploadImage(app, diego.accessToken, await image({ width: 30, height: 12 }), 'photo.png').expect(201);

      const { url } = response.body.data.attributes;
      expect(url).toMatch(extension);
      const served = await fetchImage(app, url).expect(200);
      expect(served.headers['content-type']).toBe(contentType);
      expect(await sharp(served.body).metadata()).toEqual(expect.objectContaining({ format, width: 30, height: 12 }));
    });

    it('gives every upload its own URL', async () => {
      const first = await uploadedImageUrl(app, diego.accessToken);
      const second = await uploadedImageUrl(app, diego.accessToken);

      expect(first).not.toBe(second);
    });

    it.each([
      ['text', Buffer.from('no soy una imagen, aunque me llame así'), 'cover.png'],
      ['a GIF', Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'), 'cover.jpg'],
      ['a truncated JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]), 'cover.jpg'],
    ])('rejects %s, whatever its extension', async (_, bytes, filename) => {
      const response = await uploadImage(app, diego.accessToken, bytes, filename).expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'unsupported_image' })]);
    });

    it('rejects an image over 3 MB', async () => {
      const heavy = await noiseImage(1100, 1100);
      expect(heavy.length).toBeGreaterThan(3 * 1024 * 1024);

      const response = await uploadImage(app, diego.accessToken, heavy).expect(413);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'image_too_large', detail: 'The image must weigh at most 3 MB' }),
      ]);
    });

    it.each([
      [4001, 10],
      [10, 4001],
    ])('rejects an image over 4000 px on a side (%i×%i)', async (width, height) => {
      const response = await uploadImage(app, diego.accessToken, await pngImage({ width, height })).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'image_dimensions_too_large', detail: 'Each side of the image must measure at most 4000 px' }),
      ]);
    });

    it('accepts an image of exactly 4000 px on a side', async () => {
      await uploadImage(app, diego.accessToken, await pngImage({ width: 4000, height: 1 })).expect(201);
    });

    it('asks for the image in the multipart field "file"', async () => {
      const response = await request(app.server)
        .post('/v1/images')
        .set('Accept', JSON_API)
        .set('Authorization', `Bearer ${diego.accessToken}`)
        .attach('image', await pngImage(), 'image.png')
        .expect(400);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'invalid_image_upload' })]);
      await request(app.server)
        .post('/v1/images')
        .set('Accept', JSON_API)
        .set('Authorization', `Bearer ${diego.accessToken}`)
        .field('description', 'sin archivo')
        .expect(400);
    });

    it('still refuses other media types', async () => {
      await request(app.server)
        .post('/v1/images')
        .set('Accept', JSON_API)
        .set('Authorization', `Bearer ${diego.accessToken}`)
        .set('Content-Type', 'image/png')
        .send(await pngImage())
        .expect(415);
    });

    it('applies the EXIF orientation and serves the image without metadata', async () => {
      // Stored 20×10 and marked "rotate 90° to display": it shows 10×20.
      const original = await jpegImage({ width: 20, height: 10 }, 6);
      expect(await sharp(original).metadata()).toEqual(expect.objectContaining({ orientation: 6, exif: expect.any(Buffer) }));

      const { url, width, height } = (await uploadImage(app, diego.accessToken, original, 'photo.jpg').expect(201)).body.data.attributes;

      expect({ width, height }).toEqual({ width: 10, height: 20 });
      const served = (await fetchImage(app, url).expect(200)).body as Buffer;
      const metadata = await sharp(served).metadata();
      expect(metadata).toEqual(expect.objectContaining({ format: 'jpeg', width: 10, height: 20 }));
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(served.includes('PaltonoCam')).toBe(false);
      expect(served.includes('GPS')).toBe(false);
    });

    it('keeps the transparency of a PNG', async () => {
      const url = (await uploadImage(app, diego.accessToken, await pngImage({}, 0.25)).expect(201)).body.data.attributes.url;

      const served = (await fetchImage(app, url).expect(200)).body as Buffer;
      const { data } = await sharp(served).raw().toBuffer({ resolveWithObject: true });
      expect([...data.subarray(0, 4)]).toEqual([200, 30, 90, 64]);
    });

    it('keeps a lossless WebP lossless', async () => {
      const original = await webpImage({ width: 16, height: 16 }, true);
      const url = (await uploadImage(app, diego.accessToken, original).expect(201)).body.data.attributes.url;

      const served = (await fetchImage(app, url).expect(200)).body as Buffer;
      expect(await sharp(served).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
    });

    it('requires an active account with a verified email', async () => {
      const png = await pngImage();
      await uploadImage(app, 'not-a-token', png).expect(401);
      await request(app.server).post('/v1/images').set('Accept', JSON_API).attach('file', png, 'image.png').expect(401);

      await register(app.server, { username: 'sin_verificar', email: 'sin@example.com' }).expect(201);
      const unverified = await uploadImage(app, await accessTokenFor(app.server, 'sin_verificar'), png).expect(403);
      expect(unverified.body.errors).toEqual([expect.objectContaining({ code: 'email_not_verified' })]);

      await setAccountStatus(app.app.get(DataSource), diego.username, 'suspended');
      await uploadImage(app, diego.accessToken, png).expect(401);
    });
  });

  describe('catalog upload quota', () => {
    it('lets a user upload 4 in 15 days and tells when the fifth will be possible', async () => {
      // Logs in again at each moment: access tokens expire long before the window does.
      const upload = async (status: number) =>
        uploadImage(app, await accessTokenFor(app.server, diego.username), await pngImage()).expect(status);
      for (let day = 0; day < 4; day++) {
        await upload(201);
        app.clock.advance(DAY);
      }

      const response = await upload(429);

      // The first upload, on 1 January, leaves the window 15 days later.
      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'upload_quota_exceeded', meta: { availableAt: '2026-01-16T00:00:00.000Z' } }),
      ]);
      app.clock.set('2026-01-15T23:59:59.999Z');
      await upload(429);
      app.clock.set('2026-01-16T00:00:00.000Z');
      await upload(201);
      // The window moves: the next frees up when the second upload, on 2 January, leaves it.
      const next = await upload(429);
      expect(next.body.errors[0].meta).toEqual({ availableAt: '2026-01-17T00:00:00.000Z' });
    });

    it('does not count rejected uploads', async () => {
      for (let i = 0; i < 3; i++) await uploadImage(app, diego.accessToken, await pngImage()).expect(201);
      await uploadImage(app, diego.accessToken, Buffer.from('falso'), 'fake.png').expect(422);
      await uploadImage(app, diego.accessToken, await pngImage({ width: 4001, height: 1 })).expect(422);
      await uploadImage(app, diego.accessToken, await noiseImage(1100, 1100)).expect(413);

      await uploadImage(app, diego.accessToken, await pngImage()).expect(201);
      await uploadImage(app, diego.accessToken, await pngImage()).expect(429);
      await uploadImage(app, diego.accessToken, await pngImage()).expect(429);
    });

    it('counts each account apart', async () => {
      const luis = await registerVerified(app, 'luis');
      for (let i = 0; i < 4; i++) await uploadImage(app, diego.accessToken, await pngImage()).expect(201);

      await uploadImage(app, luis.accessToken, await pngImage()).expect(201);
    });

    it('does not limit moderators and administrators', async () => {
      const admin = await registerFirstAdmin(app);
      await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Diseña las imágenes' }).expect(201);
      const moderatorToken = await accessTokenFor(app.server, diego.username);

      for (let i = 0; i < 6; i++) {
        await uploadImage(app, admin.accessToken, await pngImage()).expect(201);
        await uploadImage(app, moderatorToken, await pngImage()).expect(201);
      }
    });
  });
});
