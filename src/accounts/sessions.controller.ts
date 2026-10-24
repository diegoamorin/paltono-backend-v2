import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiBody, ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { Client, LoginDocument } from './dto/login.dto';
import { SessionRefreshDocument } from './dto/session-refresh.dto';
import { RateLimited } from './rate-limited.decorator';
import { NewSessionMeta, SessionResource, sessionSchema } from './session.resource';
import { Authentication, NewSession, SessionsService } from './sessions.service';

/** Carries the refresh token of web clients; the API and the main app share paltono.com. */
export const REFRESH_TOKEN_COOKIE = 'paltono_refresh_token';
const REFRESH_TOKEN_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/v1' } as const;

const SESSION_QUERY = resourceQuery(sessionSchema);

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
  @ApiJsonApiQuery(SESSION_QUERY)
  @ApiJsonApiBody(LoginDocument)
  @ApiJsonApiResourceResponse(SessionResource, 201, NewSessionMeta)
  @ApiJsonApiErrorResponses(400, 401, 403, 406, 415, 422, 429)
  async login(
    @Body() body: LoginDocument,
    @JsonApiQuery(SESSION_QUERY) query: ResourceQuery,
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

    return newSessionDocument(created, query, client, response);
  }

  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiOperation({ summary: 'Cerrar sesión', description: 'Revoca la sesión actual y borra la cookie de renovación.' })
  @ApiNoContentResponse({ description: 'Sesión cerrada' })
  @ApiJsonApiErrorResponses(406)
  async logout(@CurrentAuthentication() { session }: Authentication, @Res({ passthrough: true }) response: Response) {
    await this.sessions.logout(session);
    clearRefreshTokenCookie(response);
  }
}

@ApiTags('accounts')
@Controller('session-refreshes')
export class SessionRefreshesController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({
    summary: 'Renovar la sesión',
    description:
      'Sustituye el token de renovación, que no vuelve a servir, y emite un token de acceso nuevo; el límite absoluto de la sesión no cambia. ' +
      'Los navegadores envían la cookie y reciben la nueva en la cookie; mobile envía data.attributes.refreshToken y recibe el nuevo en meta.refreshToken.',
  })
  @ApiJsonApiQuery(SESSION_QUERY)
  @ApiJsonApiBody(SessionRefreshDocument)
  @ApiJsonApiResourceResponse(SessionResource, 200, NewSessionMeta)
  @ApiJsonApiErrorResponses(400, 401, 406, 415, 422)
  async refresh(
    @Body() body: SessionRefreshDocument,
    @JsonApiQuery(SESSION_QUERY) query: ResourceQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bodyToken = body.data.attributes?.refreshToken;
    const cookieToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    const client: Client = bodyToken ? 'mobile' : 'web';
    const refreshed = await this.sessions.refresh(bodyToken ?? cookieToken ?? '');
    return newSessionDocument(refreshed, query, client, response);
  }
}

/** Tells the browser to forget its refresh token, once the session behind it has ended. */
export function clearRefreshTokenCookie(response: Response): void {
  response.clearCookie(REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_OPTIONS);
}

/** The document answering a login or refresh; the refresh token goes in a cookie (web) or in meta (mobile). */
function newSessionDocument(created: NewSession, query: ResourceQuery, client: Client, response: Response) {
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

/** Reads one cookie as sent; refresh tokens are base64url, so they need no decoding. */
function readCookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}
