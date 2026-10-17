import { spawn } from 'node:child_process';
import { Client } from 'pg';

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

/** Runs SQL against the test database, for console tests that observe its contents. */
export async function queryTestDatabase<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    return (await client.query(sql)).rows as T[];
  } finally {
    await client.end();
  }
}

/** A database URL on the same server as the test database, naming another database. */
export function otherDatabaseUrl(database: string): string {
  const url = new URL(process.env.DATABASE_URL_TEST!);
  url.pathname = `/${database}`;
  return url.toString();
}
