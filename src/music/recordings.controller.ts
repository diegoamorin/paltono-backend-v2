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

// `include` stops at two levels: the linkage of each included release names its release group.
const INCLUDE = [
  'artistCredits',
  'artistCredits.artist',
  'contributions',
  'contributions.identity',
  'contributions.role',
  'genres',
  'recordingWorks',
  'recordingWorks.work',
  'platformLinks',
  'platformLinks.platform',
  'tracks',
  'tracks.release',
];

/** What lists of recordings accept, besides their filters. */
export const RECORDINGS_OPTIONS: CollectionQueryOptions = { include: INCLUDE, sort: ['title', 'recordingDate', 'releaseDate', 'createdAt'], defaultSort: 'title' };

const RECORDING_QUERY = resourceQuery(recordingSchema, { include: INCLUDE });

const RECORDINGS_QUERY = collectionQuery(recordingSchema, {
  ...RECORDINGS_OPTIONS,
  filters: ['q', 'isrc', 'genre', 'contributor', 'work', 'artist', 'year', 'releaseYear', 'isExplicit'],
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
      'de su crédito de artista o del crédito impreso de una pista en una edición publicada; `filter[year]`, el año de ' +
      'grabación; `filter[releaseYear]`, el año de su fecha de lanzamiento; `filter[isExplicit]`, `true` o `false`. Orden ' +
      '`title` (por defecto), `-recordingDate`, `-releaseDate` (fechas desconocidas al final en ambos) o `-createdAt`. ' +
      '`include` admite `artistCredits` y `artistCredits.artist`, con el nombre listo para mostrar en `displayName`, y ' +
      '`platformLinks.platform` para escucharla.',
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
      'Título, contenido explícito, ISRC, fecha parcial de grabación y fecha de lanzamiento (la más temprana de sus ediciones ' +
      'publicadas y no canceladas con fecha, incluidas las futuras), con su crédito de artista, sus créditos, géneros, obras, ' +
      'enlaces de plataforma (dónde escucharla, a lo sumo uno por plataforma) y apariciones en ediciones. `meta.editorialEntityId` es su UUID editorial. Una reserva no existe: responde 404. Una ficha retirada solo ' +
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
