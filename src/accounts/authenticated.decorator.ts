import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { ApiJsonApiErrorResponses } from '../common/json-api/swagger';
import { Authentication, SessionsService } from './sessions.service';

/**
 * Access levels of the endpoint matrix:
 * - `optional` (`Pub`): anyone, but a request with an access token is made as that account,
 *   for public resources that show more to their author or to staff;
 * - `authenticated` (`Auth`): any account that can log in, verified or not;
 * - `verified` (`Ver`): an active account with a verified email, as contributing requires;
 * - `staff` (`Staff`): `verified` with the moderator or administrator role;
 * - `admin` (`Admin`): `verified` with the administrator role.
 */
export type AccessLevel = 'optional' | 'authenticated' | 'verified' | 'staff' | 'admin';

const ACCESS_LEVEL = Symbol('ACCESS_LEVEL');

type AuthenticatedRequest = Request & { authentication?: Authentication };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const level = this.reflector.get<AccessLevel>(ACCESS_LEVEL, context.getHandler()) ?? 'authenticated';
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    if (level === 'optional' && request.headers.authorization === undefined) return true;
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const authentication = scheme === 'Bearer' && token ? await this.sessions.authenticate(token) : undefined;
    if (!authentication) {
      http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
      throw new JsonApiException(HttpStatus.UNAUTHORIZED, [
        { code: 'unauthenticated', detail: 'A valid access token is required', source: { header: 'Authorization' } },
      ]);
    }
    if (level !== 'optional' && level !== 'authenticated' && !authentication.user.emailVerified) {
      throw new JsonApiException(HttpStatus.FORBIDDEN, [
        { code: 'email_not_verified', detail: 'Verify your email before doing this' },
      ]);
    }
    if (level === 'staff' && authentication.user.role !== 'moderator' && authentication.user.role !== 'admin') {
      throw new JsonApiException(HttpStatus.FORBIDDEN, [
        { code: 'staff_required', detail: 'Only moderators and administrators can do this' },
      ]);
    }
    if (level === 'admin' && authentication.user.role !== 'admin') {
      throw new JsonApiException(HttpStatus.FORBIDDEN, [
        { code: 'administrator_required', detail: 'Only an administrator can do this' },
      ]);
    }

    request.authentication = authentication;
    return true;
  }
}

/** Requires an access token for the given level, rereading session and account on every request. */
export function Authenticated(level: AccessLevel = 'authenticated') {
  return applyDecorators(
    SetMetadata(ACCESS_LEVEL, level),
    UseGuards(AccessGuard),
    ApiBearerAuth(),
    ApiJsonApiErrorResponses(...(level === 'optional' || level === 'authenticated' ? [401] : [401, 403])),
  );
}

/** The account and session of a request to an `@Authenticated()` endpoint. */
export const CurrentAuthentication = createParamDecorator(
  (_: unknown, context: ExecutionContext): Authentication =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authentication!,
);

/** The account and session of a request to an `@Authenticated('optional')` endpoint, if it sent a token. */
export const CurrentViewer = createParamDecorator(
  (_: unknown, context: ExecutionContext): Authentication | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authentication,
);
