import 'reflect-metadata';
import { loadEnvFile } from '../config/app-config';
import { prepareTestDatabase } from '../database/test-database';
import { runCommand } from './run-command';

// `pnpm db:test:prepare`: recreates DATABASE_URL_TEST from the migrations.
loadEnvFile();

runCommand(async () => {
  await prepareTestDatabase(process.env);
  return 'Test database recreated from the migrations.';
});
