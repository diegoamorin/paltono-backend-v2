import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { QuerySpec, parseQuery } from './query';

/**
 * Injects the parsed `include`, `fields[type]`, `page`, `sort` and `filter`
 * parameters, rejecting with 400 anything the spec does not allow. Annotate the
 * parameter as `CollectionQuery` or `ResourceQuery` to match the spec.
 */
export const JsonApiQuery = createParamDecorator((spec: QuerySpec, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const path = (request.originalUrl ?? request.url).split('?')[0];
  return parseQuery(spec, request.query, path);
});
