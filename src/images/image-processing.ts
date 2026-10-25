import { HttpStatus } from '@nestjs/common';
import sharp, { Sharp } from 'sharp';
import { JsonApiException } from '../common/json-api/json-api.exception';

/** Upload limits of ADR 0005. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_SIDE_PX = 4000;

interface ImageFormat {
  extension: string;
  contentType: string;
  /** Recompresses without visible loss, keeping the format. */
  encode(image: Sharp, original: Buffer): Sharp;
}

/** The accepted formats, by the name sharp detects from the content. */
const FORMATS: Record<string, ImageFormat> = {
  jpeg: {
    extension: 'jpg',
    contentType: 'image/jpeg',
    encode: (image) => image.jpeg({ quality: 85, mozjpeg: true }),
  },
  png: {
    extension: 'png',
    contentType: 'image/png',
    encode: (image) => image.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }),
  },
  webp: {
    extension: 'webp',
    contentType: 'image/webp',
    encode: (image, original) => image.webp(isLosslessWebp(original) ? { lossless: true } : { quality: 85 }),
  },
};

export interface ProcessedImage {
  bytes: Buffer;
  extension: string;
  contentType: string;
  /** Of the processed image: a side swaps with the original's when the EXIF orientation rotates it. */
  width: number;
  height: number;
}

/**
 * Validates an uploaded file and prepares it for storage: the format comes from
 * the content (JPEG, PNG or WebP), whatever its name; the EXIF orientation is
 * applied and every metadata removed; the format and size stay. Rejects with a
 * JSON:API error before anything is stored.
 */
export async function processImage(file: Buffer): Promise<ProcessedImage> {
  if (file.length > MAX_IMAGE_BYTES) throw imageTooLarge();
  const metadata = await sharp(file)
    .metadata()
    .catch(() => undefined);
  const format = metadata?.format ? FORMATS[metadata.format] : undefined;
  if (!metadata || !format) throw unsupportedImage();
  if ((metadata.width ?? 0) > MAX_IMAGE_SIDE_PX || (metadata.height ?? 0) > MAX_IMAGE_SIDE_PX) {
    throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [
      { code: 'image_dimensions_too_large', detail: `Each side of the image must measure at most ${MAX_IMAGE_SIDE_PX} px` },
    ]);
  }

  // sharp drops all metadata unless asked to keep it; autoOrient applies the EXIF orientation first.
  const { data: bytes, info } = await format
    .encode(sharp(file).autoOrient(), file)
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw unsupportedImage();
    });
  return { bytes, extension: format.extension, contentType: format.contentType, width: info.width, height: info.height };
}

export function imageTooLarge(): JsonApiException {
  return new JsonApiException(HttpStatus.PAYLOAD_TOO_LARGE, [
    { code: 'image_too_large', detail: `The image must weigh at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB` },
  ]);
}

function unsupportedImage(): JsonApiException {
  return new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [
    { code: 'unsupported_image', detail: 'The file must be a JPEG, PNG or WebP image' },
  ]);
}

/** A WebP whose image chunk is `VP8L` was encoded without loss (RIFF container, chunks from byte 12). */
function isLosslessWebp(file: Buffer): boolean {
  let offset = 12;
  while (offset + 8 <= file.length) {
    const chunk = file.toString('ascii', offset, offset + 4);
    if (chunk === 'VP8L') return true;
    if (chunk === 'VP8 ') return false;
    const size = file.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return false;
}
