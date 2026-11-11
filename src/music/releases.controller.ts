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
import { EDITIONS_OPTIONS } from './editions.controller';
import { EditionsService } from './editions.service';
import { EditionResource, ReleaseResource, editionSchema, releaseSchema } from './release.resource';
import { ReleasesService } from './releases.service';

const INCLUDE = ['artistCredits', 'artistCredits.artist', 'editions', 'repackageOf'];

/** What lists of releases accept, besides their filters. */
export const RELEASES_OPTIONS: CollectionQueryOptions = {
  include: INCLUDE,
  sort: ['releaseDate', 'title', 'createdAt'],
  defaultSort: '-releaseDate',
};

const RELEASE_QUERY = resourceQuery(releaseSchema, { include: INCLUDE });

const RELEASES_QUERY = collectionQuery(releaseSchema, {
  ...RELEASES_OPTIONS,
  filters: ['q', 'type', 'artist', 'upcoming', 'releasedFrom', 'releasedTo'],
});

const REPACKAGES_QUERY = collectionQuery(releaseSchema, RELEASES_OPTIONS);

const RELEASE_EDITIONS_QUERY = collectionQuery(editionSchema, { ...EDITIONS_OPTIONS, filters: ['q', 'availability', 'releasedFrom', 'releasedTo'] });

export const DATES =
  'La fecha de un lanzamiento es la más temprana de sus ediciones publicadas y no canceladas; es próximo mientras ninguna ' +
  'haya salido. Una edición sale en su instante (fecha completa, hora y zona IANA) o, sin él, el primer día de su fecha parcial (UTC).';

@ApiTags('music')
@Controller('releases')
export class ReleasesController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly editions: EditionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar lanzamientos',
    description:
      'Lanzamientos publicados; una ficha retirada solo se consulta por su id. `filter[q]` busca en el título sin distinguir ' +
      'mayúsculas ni acentos; `filter[type]` admite `album`, `ep`, `single` y `compilation`; `filter[artist]` toma el public_id ' +
      'de un artista de su crédito de artista; `filter[upcoming]`, `true` o `false`; `filter[releasedFrom]` y ' +
      '`filter[releasedTo]` (YYYY, YYYY-MM o YYYY-MM-DD) acotan la fecha derivada, e incluyen una fecha parcial que se solapa ' +
      `con el rango. ${DATES} Orden \`-releaseDate\` (por defecto), \`releaseDate\` (útil con \`upcoming\`), \`title\` o ` +
      '`-createdAt`; los lanzamientos sin fecha van al final.',
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
    summary: 'Ver un lanzamiento',
    description:
      'Título, tipo y descripción, con su crédito de artista, ediciones y lanzamiento original si es un repackage. ' +
      `${DATES} \`nextReleaseDate\` es la fecha de su próxima edición por salir y \`releaseInstant\`, el instante de la primera ` +
      'edición próxima con hora, para la cuenta regresiva. `meta.editorialEntityId` es su UUID editorial. Una reserva responde ' +
      '404; una ficha retirada solo muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento' })
  @ApiJsonApiQuery(RELEASE_QUERY)
  @ApiJsonApiResourceResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(RELEASE_QUERY) query: ResourceQuery) {
    return resourceDocument(releaseSchema, await this.releases.show(id), query);
  }

  @Get(':id/editions')
  @ApiOperation({
    summary: 'Ediciones de un lanzamiento',
    description:
      'Ediciones publicadas del lanzamiento, con los filtros `q`, `availability`, `releasedFrom` y `releasedTo` y los órdenes de ' +
      '`GET /v1/editions`. Un lanzamiento retirado no muestra ninguna.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento' })
  @ApiJsonApiQuery(RELEASE_EDITIONS_QUERY)
  @ApiJsonApiCollectionResponse(EditionResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async editionsOf(@Param('id') id: string, @JsonApiQuery(RELEASE_EDITIONS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.editions.ofRelease(id, query);
    return collectionDocument(editionSchema, entries, total, query);
  }

  @Get(':id/repackages')
  @ApiOperation({
    summary: 'Repackages de un lanzamiento',
    description: 'Lanzamientos publicados que relanzan este como repackage. Un lanzamiento retirado no muestra ninguno.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento original' })
  @ApiJsonApiQuery(REPACKAGES_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async repackages(@Param('id') id: string, @JsonApiQuery(REPACKAGES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.releases.repackages(id, query);
    return collectionDocument(releaseSchema, entries, total, query);
  }
}
