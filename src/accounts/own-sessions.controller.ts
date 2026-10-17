import { Controller, Delete, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { OwnSessionResource, ownSessionSchema } from './session.resource';
import { Authentication, SessionsService } from './sessions.service';

const OWN_SESSIONS_QUERY = collectionQuery(ownSessionSchema, { sort: ['createdAt', 'expiresAt'], defaultSort: '-createdAt' });

/** Session ids are identity columns; anything else names no session. */
const SESSION_ID = /^[1-9]\d{0,9}$/;

@ApiTags('accounts')
@Controller('me/sessions')
export class OwnSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'Listar las sesiones abiertas propias', description: 'Marca con current la sesión que hace la petición.' })
  @ApiJsonApiQuery(OWN_SESSIONS_QUERY)
  @ApiJsonApiCollectionResponse(OwnSessionResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@CurrentAuthentication() { user, session }: Authentication, @JsonApiQuery(OWN_SESSIONS_QUERY) query: CollectionQuery) {
    const { sessions, total } = await this.sessions.listOpen(user, query);
    const own = sessions.map((each) => ({ ...each, current: each.id === session.id }));
    return collectionDocument(ownSessionSchema, own, total, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiOperation({ summary: 'Revocar una sesión propia', description: 'Una sesión de otra cuenta responde 404.' })
  @ApiParam({ name: 'id', description: 'Id de la sesión' })
  @ApiNoContentResponse({ description: 'Sesión revocada' })
  @ApiJsonApiErrorResponses(404, 406)
  async revoke(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string): Promise<void> {
    if (!SESSION_ID.test(id) || Number(id) > 2 ** 31 - 1) {
      throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'session_not_found', detail: 'The session does not exist' }]);
    }
    await this.sessions.revokeOwn(user, Number(id));
  }
}
