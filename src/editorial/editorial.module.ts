import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './decisions.service';
import { EditorialEntitiesController } from './editorial-entities.controller';
import { EditorialEntitiesService } from './editorial-entities.service';
import { EditorialOperationsController } from './editorial-operations.controller';
import { ProposalChangesController, ProposalSourcesController } from './proposal-contents.controller';
import { ProposalChangesService } from './proposal-changes.service';
import { ProposalSourcesService } from './proposal-sources.service';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { ChangeDecision } from './entities/change-decision.entity';
import { ChangeProposal } from './entities/change-proposal.entity';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';
import { ProposalChange } from './entities/proposal-change.entity';
import { ChangeDependency, ChangeSource } from './entities/proposal-links.entity';
import { ProposalSource } from './entities/proposal-source.entity';

/**
 * Editorial contributions: reservations, proposals, microchanges, their
 * sources and the decisions that apply them. Every write to the catalog goes
 * through this flow.
 */
@Module({
  imports: [
    AccountsModule,
    TypeOrmModule.forFeature([
      EditorialEntity,
      ChangeProposal,
      ProposalChange,
      ChangeDependency,
      ProposalSource,
      ChangeSource,
      ChangeDecision,
      EntityRevision,
    ]),
  ],
  controllers: [
    EditorialOperationsController,
    EditorialEntitiesController,
    ProposalsController,
    ProposalChangesController,
    ProposalSourcesController,
    DecisionsController,
  ],
  providers: [EditorialEntitiesService, ProposalsService, ProposalChangesService, ProposalSourcesService, DecisionsService],
})
export class EditorialModule {}
