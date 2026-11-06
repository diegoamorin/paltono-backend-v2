import 'reflect-metadata';
import { loadEnvFile } from '../config/app-config';
import { prepareTestDatabase } from '../database/test-database';
import { runCommand } from './run-command';

// `pnpm db:test:prepare`: creates the test database if missing, replaces it if it does not use ICU, and recreates it from the migrations.
loadEnvFile();

runCommand(async () => {
  await prepareTestDatabase(process.env);
  return 'Test database recreated from the migrations.';
});
