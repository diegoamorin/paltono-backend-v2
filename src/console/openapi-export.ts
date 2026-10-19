import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../app.module';
import { APP_OPTIONS, configureApp } from '../app.setup';
import { loadConfig } from '../config/app-config';
import { createOpenApiDocument } from '../swagger.setup';
import { runCommand } from './run-command';

// `pnpm openapi:export [path]`: writes the OpenAPI document that `/docs-json` serves, to `openapi.json` by default.
// Preview mode reads the controllers' metadata without instantiating providers, so no database is needed; the
// configuration is fixed rather than read from the environment, so every machine writes the same file.
runCommand(async () => {
  const path = resolve(process.argv[2] ?? 'openapi.json');
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgres://localhost/unused' });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    ...APP_OPTIONS,
    preview: true,
    logger: false,
  });
  try {
    configureApp(app, config);
    await writeFile(path, `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`);
    return `Wrote the OpenAPI document to ${path}`;
  } finally {
    await app.close();
  }
});
