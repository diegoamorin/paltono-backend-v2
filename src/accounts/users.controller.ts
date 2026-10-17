import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiBody, ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { DEFAULT_FRONTEND } from '../config/app-config';
import { OwnAccountResource, ownAccountSchema } from './account.resource';
import { RegistrationDocument } from './dto/registration.dto';
import { RateLimited } from './rate-limited.decorator';
import { RegistrationService } from './registration.service';

const REGISTRATION_QUERY = resourceQuery(ownAccountSchema);

@ApiTags('accounts')
@Controller('users')
export class UsersController {
  constructor(private readonly registration: RegistrationService) {}

  @Post()
  @RateLimited()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrarse', description: 'Crea una cuenta sin verificar y envía el correo de verificación.' })
  @ApiJsonApiQuery(REGISTRATION_QUERY)
  @ApiJsonApiBody(RegistrationDocument)
  @ApiJsonApiResourceResponse(OwnAccountResource, 201)
  @ApiJsonApiErrorResponses(400, 406, 409, 415, 422, 429)
  async register(@Body() body: RegistrationDocument, @JsonApiQuery(REGISTRATION_QUERY) query: ResourceQuery) {
    const { frontend = DEFAULT_FRONTEND, ...account } = body.data.attributes;
    const user = await this.registration.register(account, frontend);
    return resourceDocument(ownAccountSchema, user, { ...query, path: `/v1/users/${user.uuid}` });
  }
}
