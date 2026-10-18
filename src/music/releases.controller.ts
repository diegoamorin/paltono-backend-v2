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
import { ReleaseResource, releaseSchema } from './release.resource';
import { ReleasesService } from './releases.service';

const INCLUDE = ['releaseGroup', 'releaseGroup.artistCredits', 'tracks', 'tracks.recording', 'contributions', 'contributions.identity'];

/** What lists of releases accept, besides their filters. */
export const RELEASES_OPTIONS: CollectionQueryOptions = { include: INCLUDE, sort: ['releaseDate', 'title', 'createdAt'], defaultSort: '-releaseDate' };

const RELEASE_QUERY = resourceQuery(releaseSchema, { include: INCLUDE });

const RELEASES_QUERY = collectionQuery(releaseSchema, {
  ...RELEASES_OPTIONS,
  filters: ['q', 'releaseGroup', 'contributor', 'availability', 'releasedFrom', 'releasedTo'],
});

const AVAILABILITY =
  'La disponibilidad se deriva: `cancelled` si está cancelada; sin fecha, `unknown`; si no, `upcoming` hasta su instante de ' +
  'salida (fecha completa, hora y zona IANA) o, sin él, hasta el primer día de su fecha parcial (UTC), y después `released`.';

@ApiTags('music')
@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar ediciones',
    description:
      'Ediciones publicadas; una ficha retirada solo se consulta por su id. `filter[q]` busca en su título (o el del lanzamiento) ' +
      'y su nombre de edición; `filter[releaseGroup]` toma el public_id de un lanzamiento; `filter[contributor]`, el public_id de ' +
      'una identidad acreditada en la edición; `filter[availability]` admite `upcoming`, `released`, `cancelled` y `unknown`; ' +
      '`filter[releasedFrom]` y `filter[releasedTo]` (YYYY, YYYY-MM o YYYY-MM-DD) incluyen una fecha parcial que se solapa con ' +
      `el rango. ${AVAILABILITY} Orden \`-releaseDate\` (por defecto; sin fecha al final), \`title\` o \`-createdAt\`.`,
  })
  @ApiJsonApiQuery(RELEASES_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(RELEASES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.releases.list(query);
    return collectionDocument(releaseSchema, entries, total, query);
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
  @ApiJsonApiQuery(RELEASE_QUERY)
  @ApiJsonApiResourceResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(RELEASE_QUERY) query: ResourceQuery) {
    return resourceDocument(releaseSchema, await this.releases.show(id), query);
  }
}
