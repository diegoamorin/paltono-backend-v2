import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { loadConfig, loadEnvFile, loadEnvironment } from '../config/app-config';
import { databaseOptions } from '../database/database-options';
import { recreateSchema } from '../database/recreate-schema';
import { seedKpop } from '../seed/seed-kpop';
import { runCommand } from './run-command';

// `pnpm db:rebuild`: drops the development database's schema, runs every migration and seeds it. Until the first
// deployment the existing migrations change in place (ADR 0006), and only a rebuild applies them again.
loadEnvFile();

runCommand(async () => {
  const environment = loadEnvironment();
  if (environment !== 'development') {
    throw new Error(`db:rebuild runs only in development; NODE_ENV is "${environment}"`);
  }
  // Without a Resend key the emails of the seeded accounts go nowhere, even if .env names one.
  const config = loadConfig({ ...process.env, RESEND_API_KEY: '' });

  const dataSource = new DataSource(databaseOptions(config.databaseUrl));
  await dataSource.initialize();
  try {
    await recreateSchema(dataSource);
  } finally {
    await dataSource.destroy();
  }

  const app = await NestFactory.createApplicationContext(AppModule.register(config), { logger: false });
  try {
    return `Rebuilt the schema from the migrations. ${await seedKpop(app)}`;
  } finally {
    await app.close();
  }
});
