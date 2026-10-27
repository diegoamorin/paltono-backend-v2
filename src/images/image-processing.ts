import { HttpStatus } from '@nestjs/common';
import sharp, { Sharp } from 'sharp';
import { JsonApiErrorInput, JsonApiException } from '../common/json-api/json-api.exception';
import { MAX_SVG_ICON_BYTES, SvgViolation, checkSvgIcon } from './svg-icons';

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
  /** Dimensions once the EXIF orientation is applied: width and height swap when it rotates the image. */
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

/**
 * Validates an uploaded platform icon and prepares it for storage: the SVG
 * rebuilt by `checkSvgIcon`, sized by its `viewBox`. Rejects with one JSON:API
 * error per violation before anything is stored.
 */
export function processPlatformIcon(file: Buffer): ProcessedImage {
  const check = checkSvgIcon(file);
  if (!check.ok) {
    if (check.violations.some(({ code }) => code === 'svg_too_large')) throw svgIconTooLarge();
    throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, check.violations.map(svgViolationError));
  }
  return { bytes: check.svg, extension: 'svg', contentType: 'image/svg+xml', width: check.width, height: check.height };
}

export function svgIconTooLarge(): JsonApiException {
  return new JsonApiException(HttpStatus.PAYLOAD_TOO_LARGE, [svgViolationError({ code: 'svg_too_large' })]);
}

function svgViolationError(violation: SvgViolation): JsonApiErrorInput {
  switch (violation.code) {
    case 'svg_too_large':
      return { code: violation.code, detail: `The icon must weigh at most ${MAX_SVG_ICON_BYTES / 1024} KB` };
    case 'svg_unparseable':
      return { code: violation.code, detail: 'The file must be a well-formed SVG document whose root is <svg>' };
    case 'svg_doctype_not_allowed':
      return { code: violation.code, detail: 'Remove the DOCTYPE and any entity declarations' };
    case 'svg_missing_viewbox':
      return { code: violation.code, detail: 'The <svg> element needs a viewBox with a positive width and height' };
    case 'svg_forbidden_element':
      return {
        code: violation.code,
        detail:
          violation.element === 'style'
            ? 'Remove the <style> element; use presentation attributes like fill instead'
            : `Remove the <${violation.element}> element`,
        meta: { element: violation.element },
      };
    case 'svg_forbidden_attribute':
      return {
        code: violation.code,
        detail:
          violation.attribute === 'style'
            ? `Remove the style attribute from <${violation.element}>; use presentation attributes like fill instead`
            : `Remove the ${violation.attribute} attribute from <${violation.element}>`,
        meta: { element: violation.element, attribute: violation.attribute },
      };
    case 'svg_external_reference':
      return {
        code: violation.code,
        detail: `The ${violation.attribute} attribute of <${violation.element}> may only reference an element of the icon, as #id`,
        meta: { element: violation.element, attribute: violation.attribute },
      };
  }
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
