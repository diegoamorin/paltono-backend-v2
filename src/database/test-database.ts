import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database-options';
import { databaseName, testDatabaseUrl } from './test-database-url';

/**
 * Returns the test database URL (see `testDatabaseUrl`) once it is safe to
 * destroy: it must name a database ending in `_test` and must not be the
 * database in `DATABASE_URL`.
 */
export function requireTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = testDatabaseUrl(env);
  if (!url) throw new Error('Refusing to touch the database: DATABASE_URL_TEST is not set');

  const target = parseDatabaseTarget(url);
  if (!target.database.endsWith('_test')) {
    throw new Error(`Refusing to touch database "${target.database}": the test database name must end in _test`);
  }
  if (env.DATABASE_URL && sameDatabase(parseDatabaseTarget(env.DATABASE_URL), target)) {
    throw new Error(`Refusing to touch database "${target.database}": DATABASE_URL_TEST points to DATABASE_URL`);
  }
  return url;
}

/** Creates the test database if missing, drops everything in it and recreates it with the migrations. */
export async function prepareTestDatabase(env: NodeJS.ProcessEnv): Promise<void> {
  const url = requireTestDatabaseUrl(env);
  await createDatabaseIfMissing(url);
  const dataSource = new DataSource(databaseOptions(url));
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}

/** Creates the database a URL names, connecting to the server's `postgres` database. */
async function createDatabaseIfMissing(url: string): Promise<void> {
  const { database } = parseDatabaseTarget(url);
  const server = new URL(url);
  server.pathname = '/postgres';
  const client = new Client({ connectionString: server.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount) return;
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)}`);
  } catch (error) {
    // Another run created it first.
    if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
  } finally {
    await client.end();
  }
}

const DUPLICATE_DATABASE = '42P04';

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

function parseDatabaseTarget(url: string): DatabaseTarget {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: databaseName(url),
  };
}

function sameDatabase(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}
