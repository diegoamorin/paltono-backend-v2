import { In } from 'typeorm';
import { SearchSource, inOrder, publishedRoot } from '../common/search/search-source';
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

export const WORK_SEARCH: SearchSource = {
  type: 'works',
  schema: workSchema,
  textsSql: `SELECT work.id::text AS id, work.title AS text FROM works work ${publishedRoot('work')}`,
  load: async (manager, ids) => {
    const works = await manager.find(Work, { where: { id: In(ids) }, relations: { editorialEntity: true } });
    return workEntries(manager, inOrder(ids, works, ({ id }) => id));
  },
};

export const RECORDING_SEARCH: SearchSource = {
  type: 'recordings',
  schema: recordingSchema,
  textsSql: `
    SELECT recording.id::text AS id, recording.title AS text FROM recordings recording ${publishedRoot('recording')}
    UNION ALL
    SELECT recording.id::text AS id, track.title AS text FROM recordings recording ${publishedRoot('recording')}
      JOIN tracks track ON track.recording_id = recording.id
      JOIN releases release ON release.id = track.release_id ${publishedRoot('release')}
      WHERE track.title IS NOT NULL`,
  load: async (manager, ids, now) => {
    const recordings = await manager.find(Recording, { where: { id: In(ids.map(Number)) }, relations: { editorialEntity: true } });
    return recordingEntries(manager, inOrder(ids, recordings, ({ id }) => id), now);
  },
};

export const RELEASE_GROUP_SEARCH: SearchSource = {
  type: 'release-groups',
  schema: releaseGroupSchema,
  textsSql: `
    SELECT grp.id::text AS id, grp.title AS text FROM release_groups grp ${publishedRoot('grp')}
    UNION ALL
    SELECT grp.id::text AS id, release.title AS text FROM release_groups grp ${publishedRoot('grp')}
      JOIN releases release ON release.release_group_id = grp.id ${publishedRoot('release')}
      WHERE release.title IS NOT NULL`,
  load: async (manager, ids, now) => {
    const groups = await manager.find(ReleaseGroup, { where: { id: In(ids.map(Number)) }, relations: { editorialEntity: true } });
    return releaseGroupEntries(manager, inOrder(ids, groups, ({ id }) => id), now, false);
  },
};
