import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { isApiRequest } from './api-prefix';
import { JsonApiException } from './json-api.exception';
import {
  JSON_API_MEDIA_TYPE,
  MULTIPART_PATHS,
  acceptsJsonApi,
  isJsonApiContentType,
  isMultipartContentType,
  sendJsonApi,
} from './media-type';

/** Enforces the JSON:API media type on every `/v1` request (415/406). */
@Injectable()
export class JsonApiMediaTypeMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (!isApiRequest(request)) return next();
    response.setHeader('Content-Type', JSON_API_MEDIA_TYPE);
    response.json = (body?: unknown) => sendJsonApi(response, body);

    if (hasBody(request) && !isJsonApiContentType(request.headers['content-type']) && !isFileUpload(request)) {
      throw new JsonApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, [
        {
          detail: `Content-Type must be ${JSON_API_MEDIA_TYPE} without parameters other than profile`,
          source: { header: 'Content-Type' },
        },
      ]);
    }
    if (!acceptsJsonApi(request.headers.accept)) {
      throw new JsonApiException(HttpStatus.NOT_ACCEPTABLE, [
        {
          detail: `Accept must allow ${JSON_API_MEDIA_TYPE} without parameters other than profile`,
          source: { header: 'Accept' },
        },
      ]);
    }
    next();
  }
}

/** A multipart body sent to one of the routes that receive a file. */
function isFileUpload(request: Request): boolean {
  const path = new URL(request.originalUrl ?? request.url, 'http://localhost').pathname;
  return MULTIPART_PATHS.includes(path) && isMultipartContentType(request.headers['content-type']);
}

function hasBody(request: Request): boolean {
  return request.headers['transfer-encoding'] !== undefined || Number(request.headers['content-length'] ?? 0) > 0;
}
