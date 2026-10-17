import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  PipeTransform,
  Post,
  Type,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../accounts/authenticated.decorator';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, ResourceQuery, resourceQuery } from '../common/json-api/query';
import { jsonApiValidationPipe } from '../common/json-api/validation';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { Vocabulary, VocabularyEntry, VocabularyStore } from './vocabulary-store';

export interface VocabularyControllerOptions {
  vocabulary: Vocabulary<any>;
  /** The provider of the vocabulary's store. */
  store: Type<VocabularyStore<any>>;
  /** Swagger descriptions. */
  resource: Type;
  createDocument: Type;
  updateDocument: Type;
  /** Spanish nouns for the operation summaries, such as `país` and `países`. */
  singular: string;
  plural: string;
  /** Extra notes on the update operation. */
  updateNotes?: string;
}

interface WriteDocument {
  data: { id?: string; attributes: object };
}

/**
 * Validates a body against a document class. The controller is built by a
 * factory, so the parameter type cannot name the class for the global pipe.
 */
function validatedAs(document: Type): PipeTransform {
  const pipe = jsonApiValidationPipe();
  return { transform: (value) => pipe.transform(value, { type: 'body', metatype: document }) };
}

/**
 * The public reads and administrator writes of a vocabulary at `/v1/{type}`:
 * GET list and detail, POST, PATCH and DELETE.
 */
export function vocabularyController(options: VocabularyControllerOptions): Type {
  const { vocabulary, store: Store, resource, createDocument, updateDocument, singular, plural } = options;
  const listQuery = vocabulary.query;
  const entryQuery = resourceQuery(vocabulary.schema);

  @ApiTags('vocabularies')
  @Controller(vocabulary.type)
  class VocabularyController {
    constructor(@Inject(Store) private readonly store: VocabularyStore<VocabularyEntry>) {}

    @Get()
    @ApiOperation({ summary: `Listar ${plural}` })
    @ApiJsonApiQuery(listQuery)
    @ApiJsonApiCollectionResponse(resource)
    @ApiJsonApiErrorResponses(400, 406)
    async list(@JsonApiQuery(listQuery) query: CollectionQuery) {
      const { entries, total } = await this.store.list(query);
      return collectionDocument(vocabulary.schema, entries, total, query);
    }

    @Get(':id')
    @ApiOperation({ summary: `Ver ${singular}` })
    @ApiParam({ name: 'id', description: `Id de ${singular}` })
    @ApiJsonApiQuery(entryQuery)
    @ApiJsonApiResourceResponse(resource)
    @ApiJsonApiErrorResponses(400, 404, 406)
    async show(@Param('id') id: string, @JsonApiQuery(entryQuery) query: ResourceQuery) {
      return resourceDocument(vocabulary.schema, await this.store.find(id), query);
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @Authenticated('admin')
    @ApiOperation({ summary: `Crear ${singular}` })
    @ApiJsonApiBody(createDocument)
    @ApiJsonApiResourceResponse(resource, 201)
    @ApiJsonApiErrorResponses(400, 406, 409, 415, 422)
    async create(@Body(validatedAs(createDocument)) body: WriteDocument, @JsonApiQuery(entryQuery) query: ResourceQuery) {
      const entry = await this.store.create(body.data.attributes);
      return resourceDocument(vocabulary.schema, entry, { ...query, path: `${query.path}/${entry.id}` });
    }

    @Patch(':id')
    @Authenticated('admin')
    @ApiOperation({ summary: `Editar ${singular}`, description: options.updateNotes })
    @ApiParam({ name: 'id', description: `Id de ${singular}` })
    @ApiJsonApiBody(updateDocument)
    @ApiJsonApiResourceResponse(resource)
    @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
    async update(
      @Param('id') id: string,
      @Body(validatedAs(updateDocument)) body: WriteDocument,
      @JsonApiQuery(entryQuery) query: ResourceQuery,
    ) {
      if (body.data.id !== id) {
        throw new JsonApiException(HttpStatus.CONFLICT, [
          { code: 'id_mismatch', detail: 'data.id must match the id in the URL', source: { pointer: '/data/id' } },
        ]);
      }
      return resourceDocument(vocabulary.schema, await this.store.update(id, body.data.attributes), query);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Authenticated('admin')
    @ApiOperation({ summary: `Borrar ${singular}`, description: 'Una entrada en uso responde 409; nunca se borra en cascada.' })
    @ApiParam({ name: 'id', description: `Id de ${singular}` })
    @ApiNoContentResponse({ description: 'Entrada borrada' })
    @ApiJsonApiErrorResponses(404, 406, 409)
    async remove(@Param('id') id: string): Promise<void> {
      await this.store.remove(id);
    }
  }

  return VocabularyController;
}
