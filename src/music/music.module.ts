import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording, RecordingArtistCredit, RecordingContribution, RecordingGenre, RecordingPlatformLink, RecordingWork } from './entities/recording.entity';
import { Work, WorkContribution } from './entities/work.entity';
import { ArtistReleaseGroupsController } from './artist-release-groups.controller';
import { Edition } from './entities/edition.entity';
import { Release, ReleaseArtistCredit } from './entities/release.entity';
import { IdentityCreditsController } from './identity-credits.controller';
import { IdentityCreditsService } from './identity-credits.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { ReleaseGroupsController } from './release-groups.controller';
import { ReleaseGroupsService } from './release-groups.service';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';
import { EditionContribution, Track, TrackArtistCredit } from './entities/track.entity';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

/**
 * Works, recordings, release groups, releases and tracks of the catalog, with
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
    ReleaseGroupsController,
    ReleasesController,
    ArtistReleaseGroupsController,
    TracksController,
  ],
  providers: [WorksService, RecordingsService, IdentityCreditsService, ReleaseGroupsService, ReleasesService, TracksService],
})
export class MusicModule {}
