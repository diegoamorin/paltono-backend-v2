import { Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { APP_OPTIONS, configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock/clock';
import { loadConfig } from '../../src/config/app-config';
import { requireTestDatabaseUrl } from '../../src/database/test-database';
import { FakeClock } from './fake-clock';

export interface TestAppOptions {
  /** Environment variables layered over the test environment, e.g. to boot as production. */
  env?: NodeJS.ProcessEnv;
  /** Extra modules mounted next to the application, such as fixture resources. */
  imports?: Type[];
}

export interface TestApp {
  app: NestExpressApplication;
  server: App;
  clock: FakeClock;
  close(): Promise<void>;
}

/** Boots the full application against the test database, with a controllable clock. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = {
    ...loadConfig({ ...process.env, ...options.env }),
    databaseUrl: requireTestDatabaseUrl(process.env),
  };
  const clock = new FakeClock();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config), ...(options.imports ?? [])],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false });
  configureApp(app, config);
  await app.init();

  return { app, server: app.getHttpServer(), clock, close: () => app.close() };
}
