import { Response } from 'express';

export const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
export const JSON_API_VERSION = { version: '1.1' } as const;

/**
 * Sends a JSON body with the bare JSON:API media type. JSON:API forbids parameters
 * such as the `charset` that Express appends to string bodies, but not to buffers.
 */
export function sendJsonApi(response: Response, body: unknown): Response {
  return response.setHeader('Content-Type', JSON_API_MEDIA_TYPE).send(Buffer.from(JSON.stringify(body)));
}

export const MULTIPART_MEDIA_TYPE = 'multipart/form-data';

/**
 * Routes that receive a file instead of a JSON:API document: their body is
 * `multipart/form-data` and their response is still JSON:API.
 */
export const MULTIPART_PATHS: readonly string[] = ['/v1/images'];

/** True when the `Content-Type` is `multipart/form-data`, whatever its boundary. */
export function isMultipartContentType(header: string | undefined): boolean {
  return !!header && parse(header).type === MULTIPART_MEDIA_TYPE;
}

/** Media type parameters a JSON:API request may carry; no extensions are supported. */
const ALLOWED_PARAMETERS = new Set(['profile']);

interface MediaType {
  type: string;
  parameters: Map<string, string>;
}

/**
 * True when the `Content-Type` is the JSON:API media type with no parameters
 * other than `profile` (JSON:API 1.1, server responsibilities).
 */
export function isJsonApiContentType(header: string | undefined): boolean {
  if (!header) return false;
  const mediaType = parse(header);
  return mediaType.type === JSON_API_MEDIA_TYPE && hasOnlyAllowedParameters(mediaType);
}

/**
 * True when the `Accept` header admits a JSON:API response: it is absent, holds a
 * wildcard, or holds at least one JSON:API instance without unsupported parameters.
 */
export function acceptsJsonApi(header: string | undefined): boolean {
  if (!header?.trim()) return true;

  return splitList(header).some((range) => {
    const mediaType = parse(range);
    mediaType.parameters.delete('q');
    if (mediaType.type === '*/*' || mediaType.type === 'application/*') return true;
    return mediaType.type === JSON_API_MEDIA_TYPE && hasOnlyAllowedParameters(mediaType);
  });
}

function hasOnlyAllowedParameters(mediaType: MediaType): boolean {
  return [...mediaType.parameters.keys()].every((name) => ALLOWED_PARAMETERS.has(name));
}

function parse(value: string): MediaType {
  const [type, ...rawParameters] = value.split(';');
  const parameters = new Map<string, string>();
  for (const raw of rawParameters) {
    const separator = raw.indexOf('=');
    if (separator === -1) continue;
    parameters.set(raw.slice(0, separator).trim().toLowerCase(), raw.slice(separator + 1).trim());
  }
  return { type: type.trim().toLowerCase(), parameters };
}

/** Splits a header list on commas outside quoted strings. */
function splitList(header: string): string[] {
  const items: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.filter((item) => item.trim());
}
