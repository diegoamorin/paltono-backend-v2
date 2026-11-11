import { publishedRoot, titleSearch } from '../common/search/search-source';
import { Recording } from './entities/recording.entity';
import { Release } from './entities/release.entity';
import { Work } from './entities/work.entity';
import { recordingEntries, workEntries } from './music-entries';
import { recordingSchema, workSchema } from './music.resource';
import { releaseGroupEntries, withReleaseArtistCredits } from './release-entries';
import { releaseGroupSchema } from './release.resource';

/*
 * What global search finds of the music catalog: titles. A release group is
 * also found by the literal titles of its published releases, which are never
 * results of their own, so an album appears once however many releases it has.
 * Likewise a recording is found by the titles its tracks show on published
 * releases; tracks are never results of their own.
 */

export const WORK_SEARCH = titleSearch({
  type: 'works',
  schema: workSchema,
  table: 'works',
  alias: 'work',
  entity: Work,
  relations: { editorialEntity: true },
  entries: (manager, works) => workEntries(manager, works),
});

export const RECORDING_SEARCH = titleSearch({
  type: 'recordings',
  schema: recordingSchema,
  table: 'recordings',
  alias: 'recording',
  alsoTexts: `
    SELECT recording.id::text AS id, track.title AS text FROM recordings recording ${publishedRoot('recording')}
      JOIN tracks track ON track.recording_id = recording.id
      JOIN editions edition ON edition.id = track.edition_id ${publishedRoot('edition')}
      WHERE track.title IS NOT NULL`,
  entity: Recording,
  relations: { editorialEntity: true },
  entries: (manager, recordings, now) => recordingEntries(manager, recordings, now),
});

export const RELEASE_GROUP_SEARCH = titleSearch({
  type: 'release-groups',
  schema: releaseGroupSchema,
  table: 'releases',
  alias: 'grp',
  alsoTexts: `
    SELECT grp.id::text AS id, edition.title AS text FROM releases grp ${publishedRoot('grp')}
      JOIN editions edition ON edition.release_id = grp.id ${publishedRoot('edition')}
      WHERE edition.title IS NOT NULL`,
  entity: Release,
  relations: { editorialEntity: true },
  // Without their releases, but with their artists for a preview.
  entries: async (manager, groups, now) => withReleaseArtistCredits(manager, await releaseGroupEntries(manager, groups, now, false)),
});
