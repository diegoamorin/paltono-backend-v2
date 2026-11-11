import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { DATES, RELEASES_OPTIONS } from './releases.controller';
import { ReleasesService } from './releases.service';
import { ReleaseResource, releaseSchema } from './release.resource';

const DISCOGRAPHY_QUERY = collectionQuery(releaseSchema, { ...RELEASES_OPTIONS, filters: ['type'] });

@ApiTags('catalog-identities')
@Controller('artists')
export class ArtistReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get(':id/releases')
  @ApiOperation({
    summary: 'Discografía de un artista',
    description:
      'Lanzamientos publicados en cuyo crédito de artista figura el artista: uno por lanzamiento, aunque tenga varias ediciones. ' +
      '`filter[type]` admite `album`, `ep`, `single` y `compilation`. Los órdenes son los de `GET /v1/releases`. ' +
      `${DATES} Un artista cuya identidad está retirada no muestra lanzamientos.`,
  })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(DISCOGRAPHY_QUERY)
  @ApiJsonApiCollectionResponse(ReleaseResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(DISCOGRAPHY_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.releases.ofArtist(id, query);
    return collectionDocument(releaseSchema, entries, total, query);
  }
}
