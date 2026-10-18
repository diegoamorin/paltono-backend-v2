import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { containsPattern } from '../database/like-pattern';
import { RECORDING_WORK_RELATION_TYPES, Recording } from './entities/recording.entity';
import { recordingEntries } from './music-entries';
import { RecordingEntry } from './music.resource';
import { WorksService } from './works.service';

/** The columns behind each sort field of the list; unknown recording dates go last either way. */
const SORT_COLUMNS: Record<string, string[]> = {
  title: ['recording.title'],
  recordingDate: ['recording.recording_year', 'recording.recording_month', 'recording.recording_day'],
  createdAt: ['recording.created_at'],
  id: ['recording.public_id'],
};

/**
 * Public reads of recordings. A row only exists once its creation is applied,
 * so a reservation is never found; a withdrawn one keeps its row and answers
 * with its notice.
 */
@Injectable()
export class RecordingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly works: WorksService,
  ) {}

  async show(publicId: string): Promise<RecordingEntry> {
    const recording = await this.dataSource.manager.findOne(Recording, { where: { publicId }, relations: { editorialEntity: true } });
    if (!recording) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'recording_not_found', detail: 'The recording does not exist' }]);
    return (await recordingEntries(this.dataSource.manager, [recording]))[0];
  }

  /** Published recordings only: a withdrawn one is reached by its id. */
  async list(query: CollectionQuery): Promise<{ entries: RecordingEntry[]; total: number }> {
    const builder = this.published();
    const { q, isrc, genre, contributor, work, artist, year, isExplicit } = query.filter;
    if (q !== undefined) builder.andWhere('unaccent(lower(recording.title)) LIKE unaccent(lower(:pattern))', { pattern: containsPattern(q) });
    if (isrc !== undefined) builder.andWhere('recording.isrc = :isrc', { isrc: isrc.replace(/-/g, '').toUpperCase() });
    if (genre !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM recording_genres assigned JOIN genres assigned_genre ON assigned_genre.id = assigned.genre_id
          WHERE assigned.recording_id = recording.id AND assigned_genre.slug = :genre
        )`,
        { genre },
      );
    }
    if (contributor !== undefined) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM recording_contributions credit JOIN catalog_identities credited ON credited.id = credit.catalog_identity_id
          WHERE credit.recording_id = recording.id AND credited.public_id = :contributor
        )`,
        { contributor },
      );
    }
    if (work !== undefined) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM recording_works link WHERE link.recording_id = recording.id AND link.work_id::text = :work)`,
        { work },
      );
    }
    // Artists are credited on tracks, which arrive with the editions of the catalog; until then no recording has one.
    if (artist !== undefined) builder.andWhere('false');
    if (year !== undefined) {
      if (!/^\d{1,4}$/.test(year)) throw badFilter('filter[year]', 'must be a year from 1 to 9999');
      builder.andWhere('recording.recording_year = :year', { year: Number(year) });
    }
    if (isExplicit !== undefined) {
      requireOneOf('filter[isExplicit]', isExplicit, ['true', 'false']);
      builder.andWhere('recording.is_explicit = :isExplicit', { isExplicit: isExplicit === 'true' });
    }
    return this.page(builder, query);
  }

  /**
   * The published recordings that perform, interpolate or sample a work,
   * optionally in one way only. A withdrawn work shows none of them.
   */
  async ofWork(workId: string, query: CollectionQuery): Promise<{ entries: RecordingEntry[]; total: number }> {
    const work = await this.works.show(workId);
    const { relationType } = query.filter;
    if (relationType !== undefined) requireOneOf('filter[relationType]', relationType, RECORDING_WORK_RELATION_TYPES);
    if (work.relations === null) return { entries: [], total: 0 };
    const builder = this.published().andWhere(
      `EXISTS (
        SELECT 1 FROM recording_works link
        WHERE link.recording_id = recording.id AND link.work_id = :workId
          AND (CAST(:relationType AS recording_work_relation_type) IS NULL OR link.relation_type = :relationType)
      )`,
      { workId: work.work.id, relationType: relationType ?? null },
    );
    return this.page(builder, query);
  }

  private published(): SelectQueryBuilder<Recording> {
    return this.dataSource.manager
      .createQueryBuilder(Recording, 'recording')
      .innerJoinAndSelect('recording.editorialEntity', 'root')
      .where(`root.publication_status = 'published'`);
  }

  private async page(builder: SelectQueryBuilder<Recording>, query: CollectionQuery): Promise<{ entries: RecordingEntry[]; total: number }> {
    for (const { field, direction } of query.sort) {
      for (const column of SORT_COLUMNS[field]) builder.addOrderBy(column, direction, 'NULLS LAST');
    }
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await recordingEntries(this.dataSource.manager, page), total };
  }
}

function badFilter(parameter: string, detail: string): JsonApiException {
  return new JsonApiException(HttpStatus.BAD_REQUEST, [{ detail: `${parameter} ${detail}`, source: { parameter } }]);
}
