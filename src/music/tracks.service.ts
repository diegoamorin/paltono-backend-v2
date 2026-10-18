import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Artist } from '../catalog-identities/entities/artist.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, requireOneOf } from '../common/json-api/query';
import { TRACK_ARTIST_RANKS, Track } from './entities/track.entity';
import { publishedTracksOf } from './music-entries';
import { RecordingsService } from './recordings.service';
import { ReleasesService } from './releases.service';
import { trackEntries } from './track-entries';
import { TrackEntry } from './track.resource';

/** The column behind each sort field of a list of tracks. */
const SORT_COLUMNS: Record<string, string> = {
  discNumber: 'track.disc_number',
  trackNumber: 'track.track_number',
  id: 'track.id',
};

const INT4 = 2_147_483_647;

/**
 * Public reads of tracks. A track is shown while its release is published:
 * the tracks of a withdrawn release are part of its withdrawn content, and a
 * release is never reserved once it has rows.
 */
@Injectable()
export class TracksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly releases: ReleasesService,
    private readonly recordings: RecordingsService,
  ) {}

  async show(id: string): Promise<TrackEntry> {
    const track = /^[1-9]\d{0,9}$/.test(id) && Number(id) <= INT4 ? await publishedTracksOf(this.dataSource.manager).andWhere('track.id = :id', { id: Number(id) }).getOne() : null;
    if (!track) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'track_not_found', detail: 'The track does not exist' }]);
    return (await trackEntries(this.dataSource.manager, [track], this.clock.now()))[0];
  }

  /** The tracklist of a release; a withdrawn one shows none. */
  async ofRelease(publicId: string, query: CollectionQuery): Promise<{ entries: TrackEntry[]; total: number }> {
    const release = await this.releases.show(publicId);
    if (release.relations === null) return { entries: [], total: 0 };
    return this.page(publishedTracksOf(this.dataSource.manager).andWhere('track.release_id = :releaseId', { releaseId: release.release.id }), query);
  }

  /** The appearances of a recording in published releases; a withdrawn recording shows none. */
  async ofRecording(publicId: string, query: CollectionQuery): Promise<{ entries: TrackEntry[]; total: number }> {
    const recording = await this.recordings.show(publicId);
    if (recording.relations === null) return { entries: [], total: 0 };
    return this.page(publishedTracksOf(this.dataSource.manager).andWhere('track.recording_id = :recordingId', { recordingId: recording.recording.id }), query);
  }

  /** The tracks of published releases an artist is credited on, optionally with one rank only. */
  async ofArtist(publicId: string, query: CollectionQuery): Promise<{ entries: TrackEntry[]; total: number }> {
    const { rank } = query.filter;
    if (rank !== undefined) requireOneOf('filter[rank]', rank, TRACK_ARTIST_RANKS);
    const artist = await this.dataSource.manager.findOne(Artist, { where: { publicId }, relations: { identity: { editorialEntity: true } } });
    if (!artist) throw new JsonApiException(HttpStatus.NOT_FOUND, [{ code: 'artist_not_found', detail: 'The artist does not exist' }]);
    // The profile of a withdrawn identity shows only its notice.
    if (artist.identity!.editorialEntity!.publicationStatus === 'withdrawn') return { entries: [], total: 0 };
    const builder = publishedTracksOf(this.dataSource.manager).andWhere(
      `EXISTS (
        SELECT 1 FROM track_artist_credits credit
        WHERE credit.track_id = track.id AND credit.artist_id = :artistId
          AND (CAST(:rank AS track_artist_rank) IS NULL OR credit.rank = :rank)
      )`,
      { artistId: artist.id, rank: rank ?? null },
    );
    return this.page(builder, query);
  }

  private async page(builder: SelectQueryBuilder<Track>, query: CollectionQuery): Promise<{ entries: TrackEntry[]; total: number }> {
    for (const { field, direction } of query.sort) builder.addOrderBy(SORT_COLUMNS[field], direction);
    const { skip, take } = pageWindow(query);
    const [page, total] = await builder.offset(skip).limit(take).getManyAndCount();
    return { entries: await trackEntries(this.dataSource.manager, page, this.clock.now()), total };
  }
}
