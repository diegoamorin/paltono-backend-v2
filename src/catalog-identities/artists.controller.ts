import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { ArtistResource, artistSchema } from './artist.resource';
import { ArtistsService } from './artists.service';

const INCLUDE = ['identity', 'identity.aliases', 'affiliations', 'affiliations.organization'];

const ARTIST_QUERY = resourceQuery(artistSchema, { include: INCLUDE });

const ARTISTS_QUERY = collectionQuery(artistSchema, {
  include: INCLUDE,
  sort: ['displayName', 'createdAt'],
  defaultSort: 'displayName',
  filters: ['q', 'identityType', 'affiliatedWith', 'affiliationStatus'],
});

@ApiTags('catalog-identities')
@Controller('artists')
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar artistas',
    description:
      'Perfiles artísticos de identidades publicadas; el de una identidad retirada solo se consulta por su id. `filter[q]` busca ' +
      'en el nombre visible y los alias de la identidad; `filter[identityType]` admite `person` y `organization`; ' +
      '`filter[affiliatedWith]` toma el public_id de una organización y `filter[affiliationStatus]`, `current`, `former` o `unknown`: ' +
      'juntos piden una misma afiliación con esa organización en ese estado. Orden `displayName` (por defecto) o `-createdAt`.',
  })
  @ApiJsonApiQuery(ARTISTS_QUERY)
  @ApiJsonApiCollectionResponse(ArtistResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(ARTISTS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.artists.list(query);
    return collectionDocument(artistSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un artista',
    description:
      'Perfil artístico con su identidad y sus afiliaciones. El perfil pertenece a la ficha de su identidad: `meta.editorialEntityId` ' +
      'es el UUID editorial de esa identidad. Si la identidad está retirada, solo muestra el aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(ARTIST_QUERY)
  @ApiJsonApiResourceResponse(ArtistResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(ARTIST_QUERY) query: ResourceQuery) {
    return resourceDocument(artistSchema, await this.artists.show(id), query);
  }
}
