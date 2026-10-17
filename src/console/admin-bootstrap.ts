import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { bootstrapAdministrator } from '../accounts/role-changes';
import { SystemClock } from '../common/clock/clock';
import { loadConfig, loadEnvFile } from '../config/app-config';
import { databaseOptions } from '../database/database-options';
import { runCommand } from './run-command';

// `pnpm admin:bootstrap -- --username <u> --reason <text>`: promotes the first
// administrator (ADR 0003). It refuses once any administrator exists and has no HTTP equivalent.
loadEnvFile();

runCommand(async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { username: { type: 'string' }, reason: { type: 'string' } },
  });
  if (!values.username?.trim()) throw new Error('--username is required');
  if (!values.reason?.trim()) throw new Error('--reason is required');
  const { username, reason } = values;

  const dataSource = new DataSource(databaseOptions(loadConfig().databaseUrl));
  await dataSource.initialize();
  try {
    const now = new SystemClock().now();
    const user = await dataSource.transaction((manager) => bootstrapAdministrator(manager, username, reason, now));
    return `${user.username} is now an administrator.`;
  } finally {
    await dataSource.destroy();
  }
});
