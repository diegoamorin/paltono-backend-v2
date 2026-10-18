import { Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { APP_OPTIONS, configureApp } from '../../src/app.setup';
import { DataSource } from 'typeorm';
import { Clock } from '../../src/common/clock/clock';
import { Mailer } from '../../src/common/mail/mailer';
import { loadConfig } from '../../src/config/app-config';
import { requireTestDatabaseUrl } from '../../src/database/test-database';
import { truncateAllTables } from '../../src/database/truncate';
import { CapturingMailer } from './capturing-mailer';
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
  mailer: CapturingMailer;
  /** Empties the database and forgets sent emails, for a clean start in each test. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const START_OF_TEST = '2026-01-01T00:00:00.000Z';

/** Rate limits generous enough that only tests about them reach them. */
const TEST_ENV: NodeJS.ProcessEnv = { AUTH_RATE_LIMIT: '1000' };

/** Boots the full application against the test database, with a controllable clock. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = {
    ...loadConfig({ ...process.env, ...TEST_ENV, ...options.env }),
    databaseUrl: requireTestDatabaseUrl(process.env),
  };
  const clock = new FakeClock(new Date(START_OF_TEST));
  const mailer = new CapturingMailer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config), ...(options.imports ?? [])],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false });
  configureApp(app, config);
  // Listening once lets supertest reuse this port; otherwise it opens one per request and Windows runs out (ENOBUFS).
  await app.listen(0, '127.0.0.1');

  const reset = async () => {
    await truncateAllTables(app.get(DataSource));
    mailer.clear();
    clock.set(START_OF_TEST);
  };

  return { app, server: app.getHttpServer(), clock, mailer, reset, close: () => app.close() };
}
