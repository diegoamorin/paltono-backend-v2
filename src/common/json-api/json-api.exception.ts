import { HttpException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

/** A JSON:API error object (https://jsonapi.org/format/1.1/#error-objects). */
export interface JsonApiError {
  status: string;
  title: string;
  code?: string;
  detail?: string;
  source?: { pointer?: string; parameter?: string; header?: string };
  meta?: Record<string, unknown>;
}

export type JsonApiErrorInput = Omit<JsonApiError, 'status' | 'title'> & { title?: string };

/** An HTTP error carrying one or more JSON:API error objects that share its status. */
export class JsonApiException extends HttpException {
  readonly errors: JsonApiError[];

  constructor(status: number, errors: JsonApiErrorInput[]) {
    const title = STATUS_CODES[status] ?? 'Error';
    super(errors[0]?.detail ?? title, status);
    this.errors = errors.map((error) => ({ status: String(status), title, ...error }));
  }
}
