import { NestApplicationOptions } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from './common/json-api/api-prefix';
import { JSON_API_MEDIA_TYPE } from './common/json-api/media-type';
import { AppConfig } from './config/app-config';
import { LOCAL_IMAGES_PATH } from './images/image-storage';
import { setupSwagger } from './swagger.setup';

/** Options for `NestFactory.create`; `configureApp` registers the body parser itself. */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** Applies the HTTP conventions shared by `main.ts` and the tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('query parser', 'simple');
  // Railway puts one proxy in front of the app: client addresses, for rate limits and sessions, come from it.
  app.set('trust proxy', 1);
  allowMainAppOrigin(app, config);
  app.useBodyParser('json', { type: ['application/json', JSON_API_MEDIA_TYPE] });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  serveLocalImages(app, config);
  setupSwagger(app, config);
}

/**
 * Only the main app may call the API from a browser, with credentials for the refresh
 * cookie (ADR 0002). Any other origin gets no `Access-Control-Allow-Origin`, so its browser blocks the response.
 */
function allowMainAppOrigin(app: NestExpressApplication, { mainAppUrl }: AppConfig): void {
  app.enableCors({
    // A list, not a string: the origin is echoed back only to a request that comes from it.
    origin: [new URL(mainAppUrl).origin],
    credentials: true,
    // Only what browsers do not already allow without asking: `HEAD` and `Accept` always are.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
}

/** A local image storage is served by the backend itself, under `/images`. */
function serveLocalImages(app: NestExpressApplication, { images }: AppConfig): void {
  if (images.storage.kind !== 'local') return;
  app.useStaticAssets(images.storage.directory, {
    prefix: LOCAL_IMAGES_PATH,
    index: false,
    dotfiles: 'deny',
    // A key names one immutable file: a new image gets a new key.
    immutable: true,
    maxAge: '365d',
    setHeaders: (response) => response.setHeader('X-Content-Type-Options', 'nosniff'),
  });
}
