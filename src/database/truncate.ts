import { DataSource } from 'typeorm';
import { MIGRATIONS_TABLE } from './database-options';

/**
 * Deletes every row in the `public` schema and restarts its sequences, keeping
 * the tables and the migration history.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<string[]> {
  const rows: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> $1 ORDER BY tablename`,
    [MIGRATIONS_TABLE],
  );
  const tables = rows.map((row) => row.tablename);
  if (tables.length > 0) {
    const list = tables.map((table) => `public."${table.replace(/"/g, '""')}"`).join(', ');
    await dataSource.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  return tables;
}
