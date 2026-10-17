import { loadEnvFile } from '../../src/config/app-config';
import { prepareTestDatabase } from '../../src/database/test-database';

export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  await prepareTestDatabase(process.env);
}
