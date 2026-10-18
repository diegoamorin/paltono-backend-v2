import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadConfig, loadEnvFile, loadEnvironment } from '../config/app-config';
import { seedKpop } from '../seed/seed-kpop';
import { runCommand } from './run-command';

// `pnpm db:seed`: fills an empty development database with test accounts and the
// K-pop catalog, created through the editorial flow (ADR 0003).
loadEnvFile();

runCommand(async () => {
  const environment = loadEnvironment();
  if (environment !== 'development') {
    throw new Error(`db:seed runs only in development; NODE_ENV is "${environment}"`);
  }
  // Without a Resend key the emails of the seeded accounts go nowhere, even if .env names one.
  const config = loadConfig({ ...process.env, RESEND_API_KEY: '' });

  const app = await NestFactory.createApplicationContext(AppModule.register(config), { logger: false });
  try {
    return await seedKpop(app);
  } finally {
    await app.close();
  }
});
