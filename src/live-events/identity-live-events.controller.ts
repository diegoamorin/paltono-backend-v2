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
@Controller('identities')
export class IdentityLiveEventsController {
  constructor(
    private readonly events: EventsService,
    private readonly tours: ToursService,
  ) {}

  @Get(':id/organized-events')
  @ApiOperation({
    summary: 'Conciertos que organiza una identidad',
    description: `Conciertos publicados donde la identidad figura como organizadora. \`filter[dateFrom]\` y \`filter[dateTo]\` como en \`GET /v1/events\`. ${SCOPED_LIST}`,
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(SCOPED_EVENTS_QUERY)
  @ApiJsonApiCollectionResponse(EventResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async organizedEvents(@Param('id') id: string, @JsonApiQuery(SCOPED_EVENTS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.events.organizedBy(id, query);
    return collectionDocument(eventSchema, entries, total, query);
  }

  @Get(':id/organized-tours')
  @ApiOperation({ summary: 'Tours que organiza una identidad', description: `Tours publicados donde la identidad figura como organizadora. ${SCOPED_LIST}` })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(SCOPED_TOURS_QUERY)
  @ApiJsonApiCollectionResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async organizedTours(@Param('id') id: string, @JsonApiQuery(SCOPED_TOURS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tours.organizedBy(id, query);
    return collectionDocument(tourSchema, entries, total, query);
  }
}
