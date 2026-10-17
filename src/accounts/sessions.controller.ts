import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiBody, ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { LoginDocument } from './dto/login.dto';
import { RateLimited } from './rate-limited.decorator';
import { NewSessionMeta, SessionResource, sessionSchema } from './session.resource';
import { Authentication, SessionsService } from './sessions.service';

/** Carries the refresh token of web clients; the API and the frontends share paltono.com. */
export const REFRESH_TOKEN_COOKIE = 'paltono_refresh_token';
const REFRESH_TOKEN_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/v1' } as const;

const LOGIN_QUERY = resourceQuery(sessionSchema);

@ApiTags('accounts')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @RateLimited()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Iniciar sesión con username o correo',
    description:
      'Devuelve el token de acceso en meta. El token de renovación viaja en una cookie HttpOnly (web) o en meta.refreshToken (mobile).',
  })
  @ApiJsonApiQuery(LOGIN_QUERY)
  @ApiJsonApiBody(LoginDocument)
  @ApiJsonApiResourceResponse(SessionResource, 201, NewSessionMeta)
  @ApiJsonApiErrorResponses(400, 401, 403, 406, 415, 422, 429)
  async login(
    @Body() body: LoginDocument,
    @JsonApiQuery(LOGIN_QUERY) query: ResourceQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { identifier, password, client } = body.data.attributes;
    const created = await this.sessions.login({
      identifier,
      password,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 512),
      ipAddress: request.ip ?? request.socket.remoteAddress ?? '0.0.0.0',
    });

    if (client === 'web') {
      response.cookie(REFRESH_TOKEN_COOKIE, created.refreshToken, {
        ...REFRESH_TOKEN_COOKIE_OPTIONS,
        expires: created.session.expiresAt,
      });
    }
    const document = resourceDocument(sessionSchema, created.session, { ...query, path: '/v1/sessions/current' });
    return {
      ...document,
      meta: {
        accessToken: created.accessToken,
        accessTokenExpiresAt: created.accessTokenExpiresAt.toISOString(),
        ...(client === 'mobile' ? { refreshToken: created.refreshToken } : {}),
      },
    };
  }

  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiOperation({ summary: 'Cerrar sesión', description: 'Revoca la sesión actual y borra la cookie de renovación.' })
  @ApiNoContentResponse({ description: 'Sesión cerrada' })
  @ApiJsonApiErrorResponses(406)
  async logout(@CurrentAuthentication() { session }: Authentication, @Res({ passthrough: true }) response: Response) {
    await this.sessions.logout(session);
    response.clearCookie(REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_OPTIONS);
  }
}
