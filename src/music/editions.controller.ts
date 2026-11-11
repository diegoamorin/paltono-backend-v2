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
import { EditionResource, editionSchema } from './release.resource';
import { EditionsService } from './editions.service';

const INCLUDE = ['release', 'release.artistCredits', 'tracks', 'tracks.recording', 'contributions', 'contributions.identity'];

/** What lists of editions accept, besides their filters. */
export const EDITIONS_OPTIONS: CollectionQueryOptions = { include: INCLUDE, sort: ['releaseDate', 'title', 'createdAt'], defaultSort: '-releaseDate' };

const EDITION_QUERY = resourceQuery(editionSchema, { include: INCLUDE });

const EDITIONS_QUERY = collectionQuery(editionSchema, {
  ...EDITIONS_OPTIONS,
  filters: ['q', 'release', 'contributor', 'availability', 'releasedFrom', 'releasedTo'],
});

const AVAILABILITY =
  'La disponibilidad se deriva: `cancelled` si está cancelada; sin fecha, `unknown`; si no, `upcoming` hasta su instante de ' +
  'salida (fecha completa, hora y zona IANA) o, sin él, hasta el primer día de su fecha parcial (UTC), y después `released`.';

@ApiTags('music')
@Controller('editions')
export class EditionsController {
  constructor(private readonly editions: EditionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar ediciones',
    description:
      'Ediciones publicadas; una ficha retirada solo se consulta por su id. `filter[q]` busca en su título (o el del lanzamiento) ' +
      'y su nombre de edición; `filter[release]` toma el public_id de un lanzamiento; `filter[contributor]`, el public_id de ' +
      'una identidad acreditada en la edición; `filter[availability]` admite `upcoming`, `released`, `cancelled` y `unknown`; ' +
      '`filter[releasedFrom]` y `filter[releasedTo]` (YYYY, YYYY-MM o YYYY-MM-DD) incluyen una fecha parcial que se solapa con ' +
      `el rango. ${AVAILABILITY} Orden \`-releaseDate\` (por defecto; sin fecha al final), \`title\` o \`-createdAt\`.`,
  })
  @ApiJsonApiQuery(EDITIONS_QUERY)
  @ApiJsonApiCollectionResponse(EditionResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(EDITIONS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.editions.list(query);
    return collectionDocument(editionSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una edición',
    description:
      'Edición con su lanzamiento, nombre de edición, fecha parcial, hora y zona, su instante de salida y su disponibilidad. ' +
      `${AVAILABILITY} \`displayTitle\` muestra su título o, si no tiene, el del lanzamiento. \`meta.editorialEntityId\` es su UUID ` +
      'editorial. Una reserva responde 404; una ficha retirada solo muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la edición' })
  @ApiJsonApiQuery(EDITION_QUERY)
  @ApiJsonApiResourceResponse(EditionResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(EDITION_QUERY) query: ResourceQuery) {
    return resourceDocument(editionSchema, await this.editions.show(id), query);
  }
}
