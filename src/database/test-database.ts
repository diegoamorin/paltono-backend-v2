import { DataSource } from 'typeorm';
import { databaseOptions } from './database-options';

/**
 * Returns `DATABASE_URL_TEST` once it is safe to destroy: it must name a
 * database ending in `_test` and must not be the database in `DATABASE_URL`.
 */
export function requireTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL_TEST;
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

/** Drops everything in the test database and recreates it with the migrations. */
export async function prepareTestDatabase(env: NodeJS.ProcessEnv): Promise<void> {
  const dataSource = new DataSource(databaseOptions(requireTestDatabaseUrl(env)));
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}

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
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

function sameDatabase(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}
