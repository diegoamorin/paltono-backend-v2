import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording, RecordingArtistCredit, RecordingContribution, RecordingGenre, RecordingPlatformLink, RecordingWork } from './entities/recording.entity';
import { Work, WorkContribution } from './entities/work.entity';
import { ArtistReleasesController } from './artist-releases.controller';
import { EditionsController } from './editions.controller';
import { EditionsService } from './editions.service';
import { Edition } from './entities/edition.entity';
import { Release, ReleaseArtistCredit } from './entities/release.entity';
import { IdentityCreditsController } from './identity-credits.controller';
import { IdentityCreditsService } from './identity-credits.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';
import { EditionContribution, Track, TrackArtistCredit } from './entities/track.entity';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

/**
 * Works, recordings, releases, editions and tracks of the catalog, with
 * their credits, genres and the relations between them. Their rows only exist
 * once the editorial flow applies a microchange, through `works.ts`,
 * `recordings.ts`, `releases.ts`, `tracks.ts` and `credits.ts`; this module
 * serves their public reads.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Work,
      WorkContribution,
      Recording,
      RecordingContribution,
      RecordingArtistCredit,
      RecordingWork,
      RecordingGenre,
      RecordingPlatformLink,
      Release,
      ReleaseArtistCredit,
      Edition,
      EditionContribution,
      Track,
      TrackArtistCredit,
    ]),
  ],
  controllers: [
    WorksController,
    RecordingsController,
    IdentityCreditsController,
    ReleasesController,
    EditionsController,
    ArtistReleasesController,
    TracksController,
  ],
  providers: [WorksService, RecordingsService, IdentityCreditsService, ReleasesService, EditionsService, TracksService],
})
export class MusicModule {}
