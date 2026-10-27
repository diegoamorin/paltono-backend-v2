import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JSON_API } from './json-api';
import { TestApp } from './test-app';

/** The public base of uploaded images in tests, served by the app itself under `/images`. */
export const TEST_IMAGE_BASE_URL = 'http://localhost/images/';

/** POST /v1/images, sending `bytes` as the multipart `file` field. */
export function uploadImage(app: TestApp, accessToken: string, bytes: Buffer, filename = 'image.png') {
  return request(app.server)
    .post('/v1/images')
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`)
    .attach('file', bytes, filename);
}

/** PUT /v1/me/avatar, sending `bytes` as the multipart `file` field. */
export function uploadAvatar(app: TestApp, accessToken: string, bytes: Buffer, filename = 'avatar.png') {
  return request(app.server)
    .put('/v1/me/avatar')
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`)
    .attach('file', bytes, filename);
}

/** POST /v1/images/platform-icons, sending `bytes` as the multipart `file` field. */
export function uploadPlatformIcon(app: TestApp, accessToken: string, bytes: Buffer, filename = 'icon.svg') {
  return request(app.server)
    .post('/v1/images/platform-icons')
    .set('Accept', JSON_API)
    .set('Authorization', `Bearer ${accessToken}`)
    .attach('file', bytes, filename);
}

/** A small valid platform icon; `label` tells icons apart. */
export function svgIcon(label = 'icon'): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${label}</title><path d="M0 0h24v24H0z"/></svg>`,
  );
}

/** Uploads a platform icon as an administrator and returns its public URL. */
export async function uploadedPlatformIconUrl(app: TestApp, adminAccessToken: string, label?: string): Promise<string> {
  const response = await uploadPlatformIcon(app, adminAccessToken, svgIcon(label)).expect(201);
  return response.body.data.attributes.url;
}

/** Uploads a small PNG as the account's avatar and returns its public URL. */
export async function uploadedAvatarUrl(app: TestApp, accessToken: string): Promise<string> {
  const response = await uploadAvatar(app, accessToken, await pngImage()).expect(200);
  return response.body.data.attributes.avatarUrl;
}

/** Uploads a small PNG and returns its public URL. */
export async function uploadedImageUrl(app: TestApp, accessToken: string): Promise<string> {
  const response = await uploadImage(app, accessToken, await pngImage()).expect(201);
  return response.body.data.attributes.url;
}

/**
 * When the file of the upload with `url` was removed, or null while it is
 * stored. No endpoint shows it, so it is read from the database.
 */
export async function fileRemovedAt(app: TestApp, url: string): Promise<Date | null> {
  const [upload] = await app.app.get(DataSource).query('SELECT file_removed_at FROM image_uploads WHERE url = $1', [url]);
  if (!upload) throw new Error(`No upload has the URL ${url}`);
  return upload.file_removed_at;
}

/**
 * Records the file of the upload with `url` as removed, as a cleanup of unused
 * catalog images would: no endpoint removes a catalog image's file yet.
 */
export async function markImageFileRemoved(app: TestApp, url: string): Promise<void> {
  const [, affected] = await app.app
    .get(DataSource)
    .query('UPDATE image_uploads SET file_removed_at = $2 WHERE url = $1', [url, app.clock.now()]);
  if (affected !== 1) throw new Error(`No upload has the URL ${url}`);
}

/** GET of an uploaded image's public URL, through the app that serves the local storage. */
export function fetchImage(app: TestApp, url: string) {
  if (!url.startsWith(TEST_IMAGE_BASE_URL)) throw new Error(`${url} is not under ${TEST_IMAGE_BASE_URL}`);
  return request(app.server)
    .get(new URL(url).pathname)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

export interface ImageOptions {
  width?: number;
  height?: number;
}

/** A solid colour of the given size, as raw pixels ready to encode. */
function canvas({ width = 8, height = 8 }: ImageOptions, alpha = 1) {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 90, alpha } } });
}

/** A PNG, half transparent by default so its alpha channel shows. */
export function pngImage(options: ImageOptions = {}, alpha = 0.5): Promise<Buffer> {
  return canvas(options, alpha).png().toBuffer();
}

/**
 * A JPEG carrying EXIF: a camera make, a GPS-like comment and the given
 * orientation (6 means "rotate 90° clockwise to display").
 */
export function jpegImage(options: ImageOptions = {}, orientation = 1): Promise<Buffer> {
  return canvas(options)
    .jpeg({ quality: 100 })
    .withExif({ IFD0: { Make: 'PaltonoCam', ImageDescription: 'GPS 37.56N 126.97E' } })
    .withMetadata({ orientation })
    .toBuffer();
}

/** An uncompressed PNG of random pixels: it weighs about width × height × 3 bytes. */
export function noiseImage(width: number, height: number): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

export function webpImage(options: ImageOptions = {}, lossless = false): Promise<Buffer> {
  return canvas(options, 0.5).webp({ lossless, quality: 90 }).toBuffer();
}
