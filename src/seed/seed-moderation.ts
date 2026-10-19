import { User } from '../accounts/entities/user.entity';
import { CatalogWriter } from './catalog-writer';
import { EditorialSeeder, SeedChange, SeedDraft } from './editorial-seeder';
import { wiki } from './kpop-catalog';
import { STEAL_THE_WIND, concert } from './kpop-releases-and-tours';
import { SeedAccounts } from './seed-accounts';

/*
 * Proposals on the published catalog that leave microchanges in every status
 * for the moderation queue and the histories: applied, satisfied by an
 * identical one, in conflict with it, rejected, blocked by a rejected
 * prerequisite, withdrawn by its author and pending; and an entry an
 * administrator withdrew. What they propose is sourced like the rest; the
 * rejected ones say why they were wrong.
 */

const BORN_PINK_SOURCES = [wiki('Born_Pink')];
const TOUR_SOURCES = ['https://www.koreajoongangdaily.com/entertainment/tomorrow-x-together-sets-perfect-storm-release/12893866'];

export async function seedModeration(seeder: EditorialSeeder, catalog: CatalogWriter, accounts: SeedAccounts): Promise<void> {
  const { moderator, editor, contributor, suspended, admin } = accounts;
  const bornPink = catalog.root('born-pink');
  const submit = async (author: User, description: string, sources: string[], changes: SeedChange[]): Promise<SeedDraft> => {
    const draft = await seeder.draft({ author, description, sources, changes });
    await seeder.submit(draft);
    return draft;
  };
  const describeBornPink = (author: User, value: string) =>
    submit(author, 'Descripción de Born Pink', BORN_PINK_SOURCES, [
      { entityId: bornPink, operation: 'set_fields', targetPath: 'release_groups.description', value },
    ]);

  // Three descriptions of the same field: once one applies, the identical one is satisfied and the other loses its base.
  const description = 'Segundo álbum de estudio de BLACKPINK, publicado el 16 de septiembre de 2022 por YG Entertainment e Interscope Records.';
  const applied = await describeBornPink(editor, description);
  await describeBornPink(contributor, description);
  await describeBornPink(suspended, 'Segundo álbum de estudio de BLACKPINK, de ocho pistas.');
  await seeder.decide(moderator, applied.changeIds[0], { action: 'apply' });

  const wrongType = await submit(contributor, 'Born Pink es un EP', BORN_PINK_SOURCES, [
    { entityId: bornPink, operation: 'set_fields', targetPath: 'release_groups.type', value: 'ep' },
  ]);
  await seeder.decide(moderator, wrongType.changeIds[0], { action: 'reject', reason: 'La fuente lo presenta como el segundo álbum de estudio del grupo.' });

  // A duplicate of a published release group: rejecting its creation blocks the credit that depends on it.
  const duplicate = await seeder.reserve(editor, 'release_group');
  const duplicated = await submit(editor, 'Alta de Born Pink', BORN_PINK_SOURCES, [
    { entityId: duplicate, operation: 'create_entity', targetPath: 'release_groups', value: { title: 'Born Pink', type: 'album', description: null, repackageOf: null } },
    {
      entityId: duplicate,
      operation: 'add_relation',
      targetPath: 'release_artist_credits',
      targetKey: { release_group_id: { entity_id: duplicate }, artist_id: { entity_id: catalog.root('blackpink') } },
      value: { position: 0, creditedAs: null },
    },
  ]);
  await seeder.decide(moderator, duplicated.changeIds[0], { action: 'reject', reason: 'Born Pink ya está publicado; se corrige en su ficha.' });

  // The same description of a tour twice: its second author withdraws theirs and the first one waits for review.
  const tourDescription = (author: User) =>
    submit(author, 'Descripción de Steal the Wind', TOUR_SOURCES, [
      {
        entityId: catalog.root(STEAL_THE_WIND.key),
        operation: 'set_fields',
        targetPath: 'tours.description',
        value: 'Quinta gira mundial de TOMORROW X TOGETHER, que empieza con tres conciertos en el KSPO Dome de Seúl.',
      },
    ]);
  await tourDescription(editor);
  const repeated = await tourDescription(contributor);
  await seeder.decide(contributor, repeated.changeIds[0], { action: 'withdraw_change' });

  // A concert published twice by mistake: an administrator withdraws the copy, which keeps its notice and history.
  const copy = 'steal-the-wind-seoul-13-copy';
  await catalog.write(contributor, {
    description: 'Alta del primer concierto de Steal the Wind en Seúl',
    sources: TOUR_SOURCES,
    events: [concert(STEAL_THE_WIND, copy, 'scheduled', { year: 2026, month: 11, day: 13 }, { country: 'KR', city: 'Seúl', venue: 'KSPO Dome' })],
  });
  const withdrawal = await seeder.draft({
    author: admin,
    description: 'Retirada de un concierto duplicado de Steal the Wind',
    sources: TOUR_SOURCES,
    changes: [{ entityId: catalog.root(copy), operation: 'withdraw_entity', targetPath: 'publication_status', value: 'withdrawn' }],
  });
  await seeder.publish(withdrawal);
}
