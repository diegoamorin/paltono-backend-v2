import { Request } from 'express';

/** Every JSON:API route lives under this prefix; `/health` and Swagger stay outside. */
export const API_PREFIX = 'v1';

const API_PATH = new RegExp(`^/${API_PREFIX}(?:[/?]|$)`);

export function isApiRequest(request: Request): boolean {
  return API_PATH.test(request.originalUrl ?? request.url);
}
