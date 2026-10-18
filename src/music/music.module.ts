import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording, RecordingContribution, RecordingGenre, RecordingWork } from './entities/recording.entity';
import { Work, WorkContribution } from './entities/work.entity';
import { ArtistReleaseGroupsController } from './artist-release-groups.controller';
import { Release, ReleaseArtistCredit, ReleaseGroup } from './entities/release.entity';
import { IdentityCreditsController } from './identity-credits.controller';
import { IdentityCreditsService } from './identity-credits.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { ReleaseGroupsController } from './release-groups.controller';
import { ReleaseGroupsService } from './release-groups.service';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

/**
 * Works, recordings, release groups and releases of the catalog, with their
 * credits, genres and the relations between them. Their rows only exist once the editorial flow
 * applies a microchange, through `works.ts`, `recordings.ts`,
 * `releases.ts` and `credits.ts`; this module serves their public reads.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Work, WorkContribution, Recording, RecordingContribution, RecordingWork, RecordingGenre, ReleaseGroup, ReleaseArtistCredit, Release])],
  controllers: [WorksController, RecordingsController, IdentityCreditsController, ReleaseGroupsController, ReleasesController, ArtistReleaseGroupsController],
  providers: [WorksService, RecordingsService, IdentityCreditsService, ReleaseGroupsService, ReleasesService],
})
export class MusicModule {}
