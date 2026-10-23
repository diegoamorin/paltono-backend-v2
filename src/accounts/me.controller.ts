import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { OwnAccountResource, ownAccountSchema } from './account.resource';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { ProfileDocument } from './dto/profile.dto';
import { ProfilesService } from './profiles.service';
import { Authentication } from './sessions.service';

const ME_QUERY = resourceQuery(ownAccountSchema);

@ApiTags('accounts')
@Controller('me')
export class MeController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Ver la cuenta propia', description: 'Disponible también para cuentas sin verificar.' })
  @ApiJsonApiQuery(ME_QUERY)
  @ApiJsonApiResourceResponse(OwnAccountResource)
  @ApiJsonApiErrorResponses(400, 406)
  show(@CurrentAuthentication() { user }: Authentication, @JsonApiQuery(ME_QUERY) query: ResourceQuery) {
    return resourceDocument(ownAccountSchema, user, query);
  }

  @Patch()
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Editar el perfil propio',
    description:
      'Nombre visible, avatar, biografía y username. Los atributos ausentes no cambian; `null` borra el avatar, y su ' +
      'archivo, o la biografía. `avatarUrl` no admite una URL: el avatar se sube con `PUT /v1/me/avatar`. El username se ' +
      'puede cambiar cuando han pasado 7 días completos desde el último cambio, y un no-op no reinicia el plazo.',
  })
  @ApiJsonApiQuery(ME_QUERY)
  @ApiJsonApiBody(ProfileDocument)
  @ApiJsonApiResourceResponse(OwnAccountResource)
  @ApiJsonApiErrorResponses(400, 406, 409, 415, 422)
  async update(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: ProfileDocument,
    @JsonApiQuery(ME_QUERY) query: ResourceQuery,
  ) {
    return resourceDocument(ownAccountSchema, await this.profiles.update(user, body.data.id, body.data.attributes), query);
  }
}
