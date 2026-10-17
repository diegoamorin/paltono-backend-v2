import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { OwnAccountResource, ownAccountSchema } from './account.resource';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { Authentication } from './sessions.service';

const ME_QUERY = resourceQuery(ownAccountSchema);

@ApiTags('accounts')
@Controller('me')
export class MeController {
  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Ver la cuenta propia', description: 'Disponible también para cuentas sin verificar.' })
  @ApiJsonApiQuery(ME_QUERY)
  @ApiJsonApiResourceResponse(OwnAccountResource)
  @ApiJsonApiErrorResponses(400, 406)
  show(@CurrentAuthentication() { user }: Authentication, @JsonApiQuery(ME_QUERY) query: ResourceQuery) {
    return resourceDocument(ownAccountSchema, user, query);
  }
}
