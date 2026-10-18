import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording, RecordingContribution, RecordingGenre, RecordingWork } from './entities/recording.entity';
import { Work, WorkContribution } from './entities/work.entity';
import { IdentityCreditsController } from './identity-credits.controller';
import { IdentityCreditsService } from './identity-credits.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';

/**
 * Works and recordings of the catalog, with their credits, genres and the
 * relations between them. Their rows only exist once the editorial flow
 * applies a microchange, through `works.ts`, `recordings.ts` and
 * `credits.ts`; this module serves their public reads.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Work, WorkContribution, Recording, RecordingContribution, RecordingWork, RecordingGenre])],
  controllers: [WorksController, RecordingsController, IdentityCreditsController],
  providers: [WorksService, RecordingsService, IdentityCreditsService],
})
export class MusicModule {}
