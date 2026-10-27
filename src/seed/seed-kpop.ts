import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CatalogWriter } from './catalog-writer';
import { EditorialSeeder } from './editorial-seeder';
import { KPOP_CATALOG } from './kpop-catalog';
import { KPOP_RELEASES_AND_TOURS } from './kpop-releases-and-tours';
import { AccountSeeder, SEED_PASSWORD } from './seed-accounts';
import { SeedImages } from './seed-images';
import { seedModeration } from './seed-moderation';
import { seedVocabularies } from './seed-vocabularies';

/**
 * Tables whose rows mean the database already holds data the seed would collide with.
 * Countries already loaded by `pnpm countries:load` don't: the seed loads them the same way.
 */
const OCCUPIED_TABLES = ['users', 'editorial_entities'];

/**
 * Seeds an empty database: the accounts of each role and status, the shared
 * vocabularies and the K-pop catalog, every entry created by proposals with
 * real sources that the seed's moderator reviews or publishes directly, and
 * then proposals left in every status of review.
 */
export async function seedKpop(app: INestApplicationContext): Promise<string> {
  const dataSource = app.get(DataSource);
  await requireEmptyDatabase(dataSource);
  const seeder = new AccountSeeder(app);
  const accounts = await seeder.createAccounts();
  const vocabularies = await seedVocabularies(app, accounts.admin);

  const editorial = new EditorialSeeder(app, accounts.moderator);
  const catalog = new CatalogWriter(editorial, vocabularies, new SeedImages(app, accounts.moderator));
  for (const { author, ...submission } of [...KPOP_CATALOG, ...KPOP_RELEASES_AND_TOURS]) await catalog.write(accounts[author], submission);
  await seedModeration(editorial, catalog, accounts);

  // Their contributions stay, attributed to them, after they lose their access.
  await seeder.suspend(accounts.admin, accounts.suspended);
  await seeder.deleteOwn(accounts.deleted);

  const [{ proposals, entities }] = await dataSource.query(
    `SELECT (SELECT count(*) FROM change_proposals) AS proposals,
            (SELECT count(*) FROM editorial_entities WHERE publication_status = 'published') AS entities`,
  );
  return (
    `Seeded the K-pop catalog: ${entities} published entries from ${proposals} proposals, some left in review. ` +
    `The seed accounts (seed_admin, seed_moderadora, seed_editora, seed_colaborador, seed_sin_verificar…) log in with the password ${SEED_PASSWORD}.`
  );
}

async function requireEmptyDatabase(dataSource: DataSource): Promise<void> {
  for (const table of OCCUPIED_TABLES) {
    const [{ occupied }] = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS occupied`);
    if (occupied) throw new Error(`The database already has data in ${table}; run pnpm db:reset before pnpm db:seed`);
  }
}
