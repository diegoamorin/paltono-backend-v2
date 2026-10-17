import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfig } from './config/app-config';

export const SWAGGER_PATH = 'docs';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Paltono API')
    .setDescription('API JSON:API del catálogo musical colaborativo de Paltono.')
    .setVersion('1')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Serves Swagger UI at `/docs` and the OpenAPI document at `/docs-json` when the
 * configuration enables them, behind basic auth when credentials are configured.
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  const { enabled, credentials } = config.swagger;
  if (!enabled) return;

  if (credentials) {
    app.use([`/${SWAGGER_PATH}`, `/${SWAGGER_PATH}-json`], basicAuth(credentials.user, credentials.password));
  }
  SwaggerModule.setup(SWAGGER_PATH, app, () => createOpenApiDocument(app));
}

function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);

  return (request: Request, response: Response, next: NextFunction) => {
    const [scheme, encoded] = (request.headers.authorization ?? '').split(' ');
    const given = Buffer.from(scheme === 'Basic' && encoded ? encoded : '', 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();

    response.setHeader('WWW-Authenticate', 'Basic realm="Paltono API docs"');
    response.status(401).send('Unauthorized');
  };
}
