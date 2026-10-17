import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig, loadEnvFile } from '../config/app-config';
import { databaseOptions } from '../database/database-options';
import { truncateAllTables } from '../database/truncate';
import { runCommand } from './run-command';

// `pnpm db:reset`: empties every table of the development database, keeping the tables.
// It also removes accounts, roles and editorial history (ADR 0003).
loadEnvFile();

runCommand(async () => {
  const config = loadConfig();
  if (config.environment !== 'development') {
    throw new Error(`db:reset runs only in development; NODE_ENV is "${config.environment}"`);
  }

  const dataSource = new DataSource(databaseOptions(config.databaseUrl));
  await dataSource.initialize();
  try {
    const tables = await truncateAllTables(dataSource);
    return `Emptied ${tables.length} tables; the tables and the migration history are kept.`;
  } finally {
    await dataSource.destroy();
  }
});
