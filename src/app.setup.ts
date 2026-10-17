import { NestApplicationOptions } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from './common/json-api/api-prefix';
import { JSON_API_MEDIA_TYPE } from './common/json-api/media-type';
import { AppConfig } from './config/app-config';
import { setupSwagger } from './swagger.setup';

/** Options for `NestFactory.create`; `configureApp` registers the body parser itself. */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** Applies the HTTP conventions shared by `main.ts` and the tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('query parser', 'simple');
  app.useBodyParser('json', { type: ['application/json', JSON_API_MEDIA_TYPE] });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  setupSwagger(app, config);
}
