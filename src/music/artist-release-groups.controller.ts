import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { DATES, RELEASE_GROUPS_OPTIONS } from './release-groups.controller';
import { ReleaseGroupsService } from './release-groups.service';
import { ReleaseGroupResource, releaseGroupSchema } from './release.resource';

const DISCOGRAPHY_QUERY = collectionQuery(releaseGroupSchema, { ...RELEASE_GROUPS_OPTIONS, filters: ['type'] });

@ApiTags('catalog-identities')
@Controller('artists')
export class ArtistReleaseGroupsController {
  constructor(private readonly groups: ReleaseGroupsService) {}

  @Get(':id/release-groups')
  @ApiOperation({
    summary: 'Discografía de un artista',
    description:
      'Lanzamientos publicados con crédito de presentación del artista: uno por lanzamiento, aunque tenga varias ediciones. ' +
      '`filter[type]` admite `album`, `ep`, `single` y `compilation`. Los órdenes son los de `GET /v1/release-groups`. ' +
      `${DATES} Un artista cuya identidad está retirada no muestra lanzamientos.`,
  })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(DISCOGRAPHY_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseGroupResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(DISCOGRAPHY_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.groups.ofArtist(id, query);
    return collectionDocument(releaseGroupSchema, entries, total, query);
  }
}
