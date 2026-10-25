import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig, loadEnvFile } from '../config/app-config';
import { databaseOptions } from '../database/database-options';
import { loadCountries } from '../vocabularies/country-list';
import { runCommand } from './run-command';

// `pnpm countries:load`: inserts the listed countries whose code is missing, in any
// environment (ADR 0007). It never changes or removes a country, so it can run again.
loadEnvFile();

runCommand(async () => {
  const dataSource = new DataSource(databaseOptions(loadConfig().databaseUrl));
  await dataSource.initialize();
  try {
    const { inserted, skipped, suspects } = await loadCountries(dataSource);
    return [
      `Inserted ${inserted.length} countries.`,
      ...(skipped.length ? [`Skipped ${skipped.length} whose code already exists: ${skipped.join(', ')}.`] : []),
      ...suspects.map(({ code, name, listedCode }) => `Check the code of ${code} "${name}": the list gives that name to ${listedCode}.`),
    ].join('\n');
  } finally {
    await dataSource.destroy();
  }
});
