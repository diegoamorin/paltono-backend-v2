import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';

export const MIGRATIONS_TABLE = 'migrations';

/**
 * Options shared by the application, the TypeORM CLI and the console commands.
 * The schema is only ever changed by explicit migrations: `synchronize` is off
 * in every environment.
 */
export function databaseOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsTableName: MIGRATIONS_TABLE,
    synchronize: false,
    migrationsRun: false,
  };
}
