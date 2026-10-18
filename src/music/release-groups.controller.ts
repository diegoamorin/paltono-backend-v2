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
import { ReleaseGroupsService } from './release-groups.service';
import { ReleaseGroupResource, ReleaseResource, releaseGroupSchema, releaseSchema } from './release.resource';
import { RELEASES_OPTIONS } from './releases.controller';
import { ReleasesService } from './releases.service';

const INCLUDE = ['artistCredits', 'artistCredits.artist', 'releases', 'repackageOf'];

/** What lists of release groups accept, besides their filters. */
export const RELEASE_GROUPS_OPTIONS: CollectionQueryOptions = {
  include: INCLUDE,
  sort: ['releaseDate', 'title', 'createdAt'],
  defaultSort: '-releaseDate',
};

const RELEASE_GROUP_QUERY = resourceQuery(releaseGroupSchema, { include: INCLUDE });

const RELEASE_GROUPS_QUERY = collectionQuery(releaseGroupSchema, {
  ...RELEASE_GROUPS_OPTIONS,
  filters: ['q', 'type', 'artist', 'upcoming', 'releasedFrom', 'releasedTo'],
});

const REPACKAGES_QUERY = collectionQuery(releaseGroupSchema, RELEASE_GROUPS_OPTIONS);

const GROUP_RELEASES_QUERY = collectionQuery(releaseSchema, { ...RELEASES_OPTIONS, filters: ['q', 'availability', 'releasedFrom', 'releasedTo'] });

export const DATES =
  'La fecha de un lanzamiento es la más temprana de sus ediciones publicadas y no canceladas; es próximo mientras ninguna ' +
  'haya salido. Una edición sale en su instante (fecha completa, hora y zona IANA) o, sin él, el primer día de su fecha parcial (UTC).';

@ApiTags('music')
@Controller('release-groups')
export class ReleaseGroupsController {
  constructor(
    private readonly groups: ReleaseGroupsService,
    private readonly releases: ReleasesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar lanzamientos',
    description:
      'Lanzamientos publicados; una ficha retirada solo se consulta por su id. `filter[q]` busca en el título sin distinguir ' +
      'mayúsculas ni acentos; `filter[type]` admite `album`, `ep`, `single` y `compilation`; `filter[artist]` toma el public_id ' +
      'de un artista con crédito de presentación; `filter[upcoming]`, `true` o `false`; `filter[releasedFrom]` y ' +
      '`filter[releasedTo]` (YYYY, YYYY-MM o YYYY-MM-DD) acotan la fecha derivada, e incluyen una fecha parcial que se solapa ' +
      `con el rango. ${DATES} Orden \`-releaseDate\` (por defecto), \`releaseDate\` (útil con \`upcoming\`), \`title\` o ` +
      '`-createdAt`; los lanzamientos sin fecha van al final.',
  })
  @ApiJsonApiQuery(RELEASE_GROUPS_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseGroupResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(RELEASE_GROUPS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.groups.list(query);
    return collectionDocument(releaseGroupSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un lanzamiento',
    description:
      'Título, tipo y descripción, con sus créditos de presentación, ediciones y lanzamiento original si es un repackage. ' +
      `${DATES} \`nextReleaseDate\` es la fecha de su próxima edición por salir y \`releaseInstant\`, el instante de la primera ` +
      'edición próxima con hora, para la cuenta regresiva. `meta.editorialEntityId` es su UUID editorial. Una reserva responde ' +
      '404; una ficha retirada solo muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento' })
  @ApiJsonApiQuery(RELEASE_GROUP_QUERY)
  @ApiJsonApiResourceResponse(ReleaseGroupResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(RELEASE_GROUP_QUERY) query: ResourceQuery) {
    return resourceDocument(releaseGroupSchema, await this.groups.show(id), query);
  }

  @Get(':id/releases')
  @ApiOperation({
    summary: 'Ediciones de un lanzamiento',
    description:
      'Ediciones publicadas del lanzamiento, con los filtros `q`, `availability`, `releasedFrom` y `releasedTo` y los órdenes de ' +
      '`GET /v1/releases`. Un lanzamiento retirado no muestra ninguna.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento' })
  @ApiJsonApiQuery(GROUP_RELEASES_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async releasesOf(@Param('id') id: string, @JsonApiQuery(GROUP_RELEASES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.releases.ofReleaseGroup(id, query);
    return collectionDocument(releaseSchema, entries, total, query);
  }

  @Get(':id/repackages')
  @ApiOperation({
    summary: 'Repackages de un lanzamiento',
    description: 'Lanzamientos publicados que relanzan este como repackage. Un lanzamiento retirado no muestra ninguno.',
  })
  @ApiParam({ name: 'id', description: 'public_id del lanzamiento original' })
  @ApiJsonApiQuery(REPACKAGES_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseGroupResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async repackages(@Param('id') id: string, @JsonApiQuery(REPACKAGES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.groups.repackages(id, query);
    return collectionDocument(releaseGroupSchema, entries, total, query);
  }
}
