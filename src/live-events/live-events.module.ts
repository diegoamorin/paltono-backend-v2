import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventArtist, EventLink, EventOrganizer, LiveEvent, Tour, TourArtist, TourLink, TourOrganizer } from './entities/live-event.entity';
import { EventsService } from './events.service';
import { ArtistLiveEventsController, EventsController, IdentityLiveEventsController, ToursController } from './live-events.controllers';
import { ToursService } from './tours.service';

/**
 * Tours and events of the catalog, with their announced artists, organizers
 * and links. Their rows only exist once the editorial flow applies a
 * microchange, through `live-events.ts`; this module serves their public reads.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tour, LiveEvent, TourArtist, EventArtist, TourOrganizer, EventOrganizer, TourLink, EventLink])],
  controllers: [EventsController, ToursController, IdentityLiveEventsController, ArtistLiveEventsController],
  providers: [EventsService, ToursService],
})
export class LiveEventsModule {}
