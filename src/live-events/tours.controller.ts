import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, CollectionQueryOptions, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { EVENTS_OPTIONS, EVENT_FILTERS, EVENT_LIST } from './events.controller';
import { EventsService } from './events.service';
import { EventResource, TourResource, eventSchema, tourSchema } from './live-event.resource';
import { ToursService } from './tours.service';

const TOUR_INCLUDE = ['artists', 'artists.artist', 'organizers', 'organizers.identity', 'links', 'links.country', 'events'];

const TOURS_OPTIONS: CollectionQueryOptions = { include: TOUR_INCLUDE, sort: ['startDate', 'title'], defaultSort: '-startDate' };

const TOURS_QUERY = collectionQuery(tourSchema, { ...TOURS_OPTIONS, filters: ['q', 'status', 'artist', 'organizer', 'country'] });
/** The tours of an identity or an artist. */
export const SCOPED_TOURS_QUERY = collectionQuery(tourSchema, { ...TOURS_OPTIONS, filters: ['status'] });
const TOUR_QUERY = resourceQuery(tourSchema, { include: TOUR_INCLUDE });
const TOUR_EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: EVENT_FILTERS.filter((name) => name !== 'tour') });

const TOUR_DERIVED = 'Sus países (`countries`) y fechas (`eventDates`) se derivan de sus conciertos publicados; nunca se editan aparte.';

@ApiTags('live-events')
@Controller('tours')
export class ToursController {
  constructor(
    private readonly tours: ToursService,
    private readonly events: EventsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar tours',
    description:
      'Tours publicados; una ficha retirada solo se consulta por su id. `filter[q]` busca en el título; `filter[status]` admite ' +
      '`announced`, `scheduled`, `in_progress`, `postponed`, `cancelled` y `completed`; `filter[artist]` toma el public_id de un ' +
      'artista anunciado; `filter[organizer]`, el de una identidad organizadora; `filter[country]`, un código de país de alguno ' +
      `de sus conciertos publicados. ${TOUR_DERIVED} Orden \`-startDate\` (por defecto, inicio anunciado) o \`title\`; los tours ` +
      'sin inicio van al final.',
  })
  @ApiJsonApiQuery(TOURS_QUERY)
  @ApiJsonApiCollectionResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(TOURS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tours.list(query);
    return collectionDocument(tourSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un tour',
    description:
      'Título, estado de negocio e inicio y fin anunciados, con sus artistas, organizadores, enlaces y conciertos publicados. ' +
      `${TOUR_DERIVED} Una reserva responde 404; una ficha retirada solo muestra su aviso.`,
  })
  @ApiParam({ name: 'id', description: 'public_id del tour' })
  @ApiJsonApiQuery(TOUR_QUERY)
  @ApiJsonApiResourceResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(TOUR_QUERY) query: ResourceQuery) {
    return resourceDocument(tourSchema, await this.tours.show(id), query);
  }

  @Get(':id/events')
  @ApiOperation({
    summary: 'Conciertos de un tour',
    description: `Conciertos publicados del tour, con los filtros y órdenes de \`GET /v1/events\` salvo \`tour\`. Un tour retirado no muestra ninguno. ${EVENT_LIST}`,
  })
  @ApiParam({ name: 'id', description: 'public_id del tour' })
  @ApiJsonApiQuery(TOUR_EVENTS_QUERY)
  @ApiJsonApiCollectionResponse(EventResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async eventsOf(@Param('id') id: string, @JsonApiQuery(TOUR_EVENTS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.events.ofTour(id, query);
    return collectionDocument(eventSchema, entries, total, query);
  }
}
