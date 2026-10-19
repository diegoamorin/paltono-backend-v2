import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { requireTestDatabaseUrl } from '../../src/database/test-database';

export interface CommandResult {
  status: number | null;
  output: string;
}

/** Runs a pnpm script the way an operator does, with extra environment variables. */
export function runPnpm(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--silent', ...args], { env: { ...process.env, ...env }, shell: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

/** The test database this run uses: `DATABASE_URL_TEST`, suffixed in a linked worktree. */
export function currentTestDatabaseUrl(): string {
  return requireTestDatabaseUrl(process.env);
}

/** Runs SQL against the test database, for console tests that observe its contents. */
export function queryTestDatabase<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  return queryDatabase<T>(currentTestDatabaseUrl(), sql, values);
}

/** Runs SQL against any database. */
export async function queryDatabase<T = Record<string, unknown>>(url: string, sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** A database URL on the same server as the test database, naming another database. */
export function otherDatabaseUrl(database: string): string {
  const url = new URL(currentTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

/** Whether a database exists on the test database's server. */
export async function databaseExists(database: string): Promise<boolean> {
  const rows = await queryTestDatabase<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
    [database],
  );
  return rows[0].exists;
}
