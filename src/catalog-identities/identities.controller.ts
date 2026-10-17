import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { IdentitiesService } from './identities.service';
import { IdentityResource, identitySchema } from './identity.resource';

const IDENTITY_QUERY = resourceQuery(identitySchema);

@ApiTags('catalog-identities')
@Controller('identities')
export class IdentitiesController {
  constructor(private readonly identities: IdentitiesService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una identidad',
    description:
      'Datos comunes y el subtipo `person` u `organization`. `meta.editorialEntityId` es su UUID editorial, para proponer cambios. ' +
      'Una reserva todavía no publicada no existe: responde 404.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(IDENTITY_QUERY)
  @ApiJsonApiResourceResponse(IdentityResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(IDENTITY_QUERY) query: ResourceQuery) {
    return resourceDocument(identitySchema, await this.identities.show(id), query);
  }
}
