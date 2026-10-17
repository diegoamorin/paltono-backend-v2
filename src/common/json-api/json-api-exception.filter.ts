import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { isApiRequest } from './api-prefix';
import { JsonApiError, JsonApiException } from './json-api.exception';
import { JSON_API_VERSION, sendJsonApi } from './media-type';

/** Renders every error under `/v1` as a JSON:API error document. */
@Catch()
export class JsonApiExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(JsonApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    if (!isApiRequest(http.getRequest<Request>())) return super.catch(exception, host);

    const { status, errors } = this.toErrors(exception);
    sendJsonApi(http.getResponse<Response>().status(status), { jsonapi: JSON_API_VERSION, errors });
  }

  private toErrors(exception: unknown): { status: number; errors: JsonApiError[] } {
    if (exception instanceof JsonApiException) {
      return { status: exception.getStatus(), errors: exception.errors };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, errors: new JsonApiException(status, [{ detail: detailOf(exception) }]).errors };
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    return { status, errors: new JsonApiException(status, [{}]).errors };
  }
}

function detailOf(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}
