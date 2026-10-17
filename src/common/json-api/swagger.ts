import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { STATUS_CODES } from 'node:http';
import { JSON_API_MEDIA_TYPE } from './media-type';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, QuerySpec } from './query';

/*
 * Swagger descriptions of the generic JSON:API documents, following the NestJS
 * technique for generic responses (`@ApiExtraModels` with `getSchemaPath`).
 * Each resource describes its resource object as a DTO class; these helpers wrap
 * it in the document shape.
 */

class JsonApiVersion {
  @ApiProperty({ example: '1.1' })
  version: string;
}

class JsonApiErrorSource {
  @ApiPropertyOptional({ example: '/data/attributes/name' })
  pointer?: string;

  @ApiPropertyOptional({ example: 'page[size]' })
  parameter?: string;

  @ApiPropertyOptional({ example: 'Content-Type' })
  header?: string;
}

class JsonApiError {
  @ApiProperty({ example: '422' })
  status: string;

  @ApiProperty({ example: 'Unprocessable Entity' })
  title: string;

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  detail?: string;

  @ApiPropertyOptional({ type: JsonApiErrorSource })
  source?: JsonApiErrorSource;
}

export class JsonApiErrorDocument {
  @ApiProperty({ type: JsonApiVersion })
  jsonapi: JsonApiVersion;

  @ApiProperty({ type: [JsonApiError] })
  errors: JsonApiError[];
}

class JsonApiResourceLinks {
  @ApiProperty()
  self: string;
}

class JsonApiPaginationLinks {
  @ApiProperty()
  self: string;

  @ApiProperty()
  first: string;

  @ApiProperty({ type: String, nullable: true })
  prev: string | null;

  @ApiProperty({ type: String, nullable: true })
  next: string | null;

  @ApiProperty()
  last: string;
}

class JsonApiCollectionMeta {
  @ApiProperty({ description: 'Total de recursos que cumplen los filtros' })
  total: number;
}

/** A resource identifier object, for relationship linkage in resource DTOs. */
export class ResourceIdentifier {
  @ApiProperty()
  type: string;

  @ApiProperty()
  id: string;
}

const included = {
  type: 'array',
  description: 'Recursos relacionados pedidos con include',
  items: { type: 'object' },
};

/** Documents a response holding one resource, optionally with a document-level `meta`. */
export function ApiJsonApiResourceResponse(resource: Type, status = 200, meta?: Type) {
  return applyDecorators(
    ApiExtraModels(resource, JsonApiVersion, JsonApiResourceLinks, ...(meta ? [meta] : [])),
    ApiResponse({
      status,
      description: STATUS_CODES[status],
      content: {
        [JSON_API_MEDIA_TYPE]: {
          schema: {
            type: 'object',
            required: ['data'],
            properties: {
              jsonapi: { $ref: getSchemaPath(JsonApiVersion) },
              data: { $ref: getSchemaPath(resource) },
              included,
              links: { $ref: getSchemaPath(JsonApiResourceLinks) },
              ...(meta ? { meta: { $ref: getSchemaPath(meta) } } : {}),
            },
          },
        },
      },
    }),
  );
}

/** Documents a response holding the few resources one request produced, without pagination. */
export function ApiJsonApiResourcesResponse(resource: Type, status = 200) {
  return applyDecorators(
    ApiExtraModels(resource, JsonApiVersion, JsonApiResourceLinks),
    ApiResponse({
      status,
      description: STATUS_CODES[status],
      content: {
        [JSON_API_MEDIA_TYPE]: {
          schema: {
            type: 'object',
            required: ['data'],
            properties: {
              jsonapi: { $ref: getSchemaPath(JsonApiVersion) },
              data: { type: 'array', items: { $ref: getSchemaPath(resource) } },
              included,
              links: { $ref: getSchemaPath(JsonApiResourceLinks) },
            },
          },
        },
      },
    }),
  );
}

/** Documents a response holding one page of resources. */
export function ApiJsonApiCollectionResponse(resource: Type) {
  return applyDecorators(
    ApiExtraModels(resource, JsonApiVersion, JsonApiPaginationLinks, JsonApiCollectionMeta),
    ApiResponse({
      status: 200,
      description: STATUS_CODES[200],
      content: {
        [JSON_API_MEDIA_TYPE]: {
          schema: {
            type: 'object',
            required: ['data', 'links', 'meta'],
            properties: {
              jsonapi: { $ref: getSchemaPath(JsonApiVersion) },
              data: { type: 'array', items: { $ref: getSchemaPath(resource) } },
              included,
              links: { $ref: getSchemaPath(JsonApiPaginationLinks) },
              meta: { $ref: getSchemaPath(JsonApiCollectionMeta) },
            },
          },
        },
      },
    }),
  );
}

/** Documents error responses, which all share the JSON:API error document. */
export function ApiJsonApiErrorResponses(...statuses: number[]) {
  return applyDecorators(
    ApiExtraModels(JsonApiErrorDocument),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: STATUS_CODES[status],
        content: { [JSON_API_MEDIA_TYPE]: { schema: { $ref: getSchemaPath(JsonApiErrorDocument) } } },
      }),
    ),
  );
}

/** Documents a request body, which uses the JSON:API media type. */
export function ApiJsonApiBody(document: Type) {
  return applyDecorators(ApiConsumes(JSON_API_MEDIA_TYPE), ApiBody({ type: document }));
}

/** Documents the query parameters a `QuerySpec` accepts. */
export function ApiJsonApiQuery(spec: QuerySpec) {
  const decorators = [...spec.fields].map(([type, fields]) =>
    ApiQuery({
      name: `fields[${type}]`,
      required: false,
      type: String,
      description: `Campos de ${type} separados por comas: ${[...fields].join(', ')}`,
    }),
  );

  if (spec.include.size > 0) {
    decorators.push(
      ApiQuery({
        name: 'include',
        required: false,
        type: String,
        description: `Relaciones separadas por comas: ${[...spec.include].join(', ')}`,
      }),
    );
  }

  if (spec.kind === 'collection') {
    const defaultSort = spec.defaultSort.map(({ field, direction }) => (direction === 'DESC' ? `-${field}` : field));
    decorators.push(
      ApiQuery({ name: 'page[number]', required: false, type: Number, description: 'Página, desde 1' }),
      ApiQuery({
        name: 'page[size]',
        required: false,
        type: Number,
        description: `Tamaño de página; ${DEFAULT_PAGE_SIZE} por defecto, ${MAX_PAGE_SIZE} como máximo`,
      }),
      ApiQuery({
        name: 'sort',
        required: false,
        type: String,
        description: `Campos separados por comas, con - para orden descendente: ${[...spec.sort].join(', ')}. Por defecto ${defaultSort.join(',')}; el id desempata`,
      }),
      ...[...spec.filters].map((filter) => ApiQuery({ name: `filter[${filter}]`, required: false, type: String })),
    );
  }

  return applyDecorators(...decorators);
}
