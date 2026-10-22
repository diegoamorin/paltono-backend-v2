import { DataSource } from 'typeorm';

/** Drops everything in the `public` schema and recreates it with the migrations. */
export async function recreateSchema(dataSource: DataSource): Promise<void> {
  await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
  await dataSource.runMigrations({ transaction: 'each' });
}
