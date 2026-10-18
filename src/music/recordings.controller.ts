import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, CollectionQueryOptions, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { RecordingResource, recordingSchema } from './music.resource';
import { RecordingsService } from './recordings.service';

// The matrix also lists `tracks.release.releaseGroup`, a third level that `include` never reaches; the linkage of each
// included release names its release group.
const INCLUDE = [
  'contributions',
  'contributions.identity',
  'contributions.role',
  'genres',
  'recordingWorks',
  'recordingWorks.work',
  'tracks',
  'tracks.release',
];

/** What lists of recordings accept, besides their filters. */
export const RECORDINGS_OPTIONS: CollectionQueryOptions = { include: INCLUDE, sort: ['title', 'recordingDate', 'createdAt'], defaultSort: 'title' };

const RECORDING_QUERY = resourceQuery(recordingSchema, { include: INCLUDE });

const RECORDINGS_QUERY = collectionQuery(recordingSchema, {
  ...RECORDINGS_OPTIONS,
  filters: ['q', 'isrc', 'genre', 'contributor', 'work', 'artist', 'year', 'isExplicit'],
});

@ApiTags('music')
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar grabaciones',
    description:
      'Grabaciones publicadas; una ficha retirada solo se consulta por su id. `filter[q]` busca en el título sin distinguir ' +
      'mayúsculas ni acentos; `filter[isrc]`, el ISRC; `filter[genre]`, el slug de un género; `filter[contributor]`, el public_id ' +
      'de una identidad acreditada; `filter[work]`, el id de una obra relacionada; `filter[artist]`, el public_id de un artista ' +
      'acreditado en una pista; `filter[year]`, el año de grabación; `filter[isExplicit]`, `true` o `false`. Orden `title` ' +
      '(por defecto), `-recordingDate` (fechas desconocidas al final) o `-createdAt`.',
  })
  @ApiJsonApiQuery(RECORDINGS_QUERY)
  @ApiJsonApiCollectionResponse(RecordingResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(RECORDINGS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.recordings.list(query);
    return collectionDocument(recordingSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una grabación',
    description:
      'Título, contenido explícito, ISRC y fecha parcial de grabación, con sus créditos, géneros, obras y apariciones en ' +
      'ediciones. `meta.editorialEntityId` es su UUID editorial. Una reserva no existe: responde 404. Una ficha retirada solo ' +
      'muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la grabación' })
  @ApiJsonApiQuery(RECORDING_QUERY)
  @ApiJsonApiResourceResponse(RecordingResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(RECORDING_QUERY) query: ResourceQuery) {
    return resourceDocument(recordingSchema, await this.recordings.show(id), query);
  }
}
