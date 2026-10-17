import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { DEFAULT_FRONTEND } from '../config/app-config';
import { OwnAccountResource, PublicAccountResource, ownAccountSchema, publicAccountSchema } from './account.resource';
import { accountId } from './administration';
import { RegistrationDocument } from './dto/registration.dto';
import { ProfilesService } from './profiles.service';
import { RateLimited } from './rate-limited.decorator';
import { RegistrationService } from './registration.service';

const REGISTRATION_QUERY = resourceQuery(ownAccountSchema);
const PROFILE_QUERY = resourceQuery(publicAccountSchema);
const PROFILE_SEARCH_QUERY = collectionQuery(publicAccountSchema, { sort: [], defaultSort: 'id', filters: ['username'] });

@ApiTags('accounts')
@Controller('users')
export class UsersController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly profiles: ProfilesService,
  ) {}

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

  @Get()
  @ApiOperation({
    summary: 'Buscar un perfil por username',
    description:
      '`filter[username]` es obligatorio y no distingue mayúsculas; devuelve 0 o 1 cuenta. No hay listado público de ' +
      'cuentas. Encuentra también el username reservado de una cuenta eliminada.',
  })
  @ApiJsonApiQuery(PROFILE_SEARCH_QUERY)
  @ApiJsonApiCollectionResponse(PublicAccountResource)
  @ApiJsonApiErrorResponses(400, 406)
  async search(@JsonApiQuery(PROFILE_SEARCH_QUERY) query: CollectionQuery) {
    const { username } = query.filter;
    if (!username) {
      throw new JsonApiException(HttpStatus.BAD_REQUEST, [
        {
          code: 'username_filter_required',
          detail: 'filter[username] is required; accounts are not listed',
          source: { parameter: 'filter[username]' },
        },
      ]);
    }
    const user = await this.profiles.findByUsername(username);
    // A search has at most one result, so every page past the first is empty.
    const users = user && query.page.number === 1 ? [user] : [];
    return collectionDocument(publicAccountSchema, users, user ? 1 : 0, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un perfil público',
    description:
      'Username, nombre visible, avatar, biografía, rol, estado y fecha de registro; nunca el correo. Una cuenta ' +
      'eliminada solo muestra su username reservado y su estado.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(PROFILE_QUERY)
  @ApiJsonApiResourceResponse(PublicAccountResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(PROFILE_QUERY) query: ResourceQuery) {
    return resourceDocument(publicAccountSchema, await this.profiles.show(accountId(id)), query);
  }
}
