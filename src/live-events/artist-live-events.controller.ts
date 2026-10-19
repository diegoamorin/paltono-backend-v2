import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { SCOPED_EVENTS_QUERY, SCOPED_LIST } from './events.controller';
import { EventsService } from './events.service';
import { EventResource, TourResource, eventSchema, tourSchema } from './live-event.resource';
import { SCOPED_TOURS_QUERY } from './tours.controller';
import { ToursService } from './tours.service';

@ApiTags('catalog-identities')
@Controller('artists')
export class ArtistLiveEventsController {
  constructor(
    private readonly events: EventsService,
    private readonly tours: ToursService,
  ) {}

  @Get(':id/events')
  @ApiOperation({
    summary: 'Conciertos de un artista',
    description:
      'Conciertos publicados donde el artista está anunciado explícitamente; pertenecer a un tour no lo anuncia en sus conciertos. ' +
      `\`filter[dateFrom]\` y \`filter[dateTo]\` como en \`GET /v1/events\`. ${SCOPED_LIST}`,
  })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(SCOPED_EVENTS_QUERY)
  @ApiJsonApiCollectionResponse(EventResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async eventsOf(@Param('id') id: string, @JsonApiQuery(SCOPED_EVENTS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.events.ofArtist(id, query);
    return collectionDocument(eventSchema, entries, total, query);
  }

  @Get(':id/tours')
  @ApiOperation({ summary: 'Tours de un artista', description: `Tours publicados donde el artista está anunciado. ${SCOPED_LIST}` })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(SCOPED_TOURS_QUERY)
  @ApiJsonApiCollectionResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async toursOf(@Param('id') id: string, @JsonApiQuery(SCOPED_TOURS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tours.ofArtist(id, query);
    return collectionDocument(tourSchema, entries, total, query);
  }
}
