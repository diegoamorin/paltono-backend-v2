import { publishedRoot, titleSearch } from '../common/search/search-source';
import { Recording } from './entities/recording.entity';
import { ReleaseGroup } from './entities/release.entity';
import { Work } from './entities/work.entity';
import { recordingEntries, workEntries } from './music-entries';
import { recordingSchema, workSchema } from './music.resource';
import { releaseGroupEntries } from './release-entries';
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
      JOIN releases release ON release.id = track.release_id ${publishedRoot('release')}
      WHERE track.title IS NOT NULL`,
  entity: Recording,
  relations: { editorialEntity: true },
  entries: (manager, recordings, now) => recordingEntries(manager, recordings, now),
});

export const RELEASE_GROUP_SEARCH = titleSearch({
  type: 'release-groups',
  schema: releaseGroupSchema,
  table: 'release_groups',
  alias: 'grp',
  alsoTexts: `
    SELECT grp.id::text AS id, release.title AS text FROM release_groups grp ${publishedRoot('grp')}
      JOIN releases release ON release.release_group_id = grp.id ${publishedRoot('release')}
      WHERE release.title IS NOT NULL`,
  entity: ReleaseGroup,
  relations: { editorialEntity: true },
  entries: (manager, groups, now) => releaseGroupEntries(manager, groups, now, false),
});
