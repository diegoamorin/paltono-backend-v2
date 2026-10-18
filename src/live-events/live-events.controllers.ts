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
import { EventsService } from './events.service';
import { EventResource, TourResource, eventSchema, tourSchema } from './live-event.resource';
import { ToursService } from './tours.service';

const EVENT_INCLUDE = ['tour', 'artists', 'artists.artist', 'organizers', 'organizers.identity', 'links', 'country'];
const TOUR_INCLUDE = ['artists', 'artists.artist', 'organizers', 'organizers.identity', 'links', 'links.country', 'events'];

const EVENTS_OPTIONS: CollectionQueryOptions = { include: EVENT_INCLUDE, sort: ['startDate', 'createdAt'], defaultSort: 'startDate' };
const TOURS_OPTIONS: CollectionQueryOptions = { include: TOUR_INCLUDE, sort: ['startDate', 'title'], defaultSort: '-startDate' };

const EVENT_FILTERS = ['q', 'status', 'country', 'city', 'artist', 'organizer', 'tour', 'dateFrom', 'dateTo'];
const EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: EVENT_FILTERS });
const TOUR_EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: EVENT_FILTERS.filter((name) => name !== 'tour') });
const SCOPED_EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: ['status', 'dateFrom', 'dateTo'] });
const EVENT_QUERY = resourceQuery(eventSchema, { include: EVENT_INCLUDE });

const TOURS_QUERY = collectionQuery(tourSchema, { ...TOURS_OPTIONS, filters: ['q', 'status', 'artist', 'organizer', 'country'] });
const SCOPED_TOURS_QUERY = collectionQuery(tourSchema, { ...TOURS_OPTIONS, filters: ['status'] });
const TOUR_QUERY = resourceQuery(tourSchema, { include: TOUR_INCLUDE });

const EVENT_LIST =
  '`filter[q]` busca en el título, el recinto y la ciudad sin distinguir mayúsculas ni acentos; `filter[status]` admite ' +
  '`announced`, `scheduled`, `postponed`, `cancelled` y `performed`; `filter[country]` toma un código de país; `filter[city]`, ' +
  'una ciudad exacta sin distinguir mayúsculas ni acentos; `filter[artist]`, el public_id de un artista anunciado; ' +
  '`filter[organizer]`, el de una identidad organizadora; `filter[tour]`, el de un tour. `filter[dateFrom]` y `filter[dateTo]` ' +
  '(YYYY, YYYY-MM o YYYY-MM-DD) incluyen una fecha parcial que se solapa con el rango y excluyen los conciertos sin fecha. ' +
  'Orden `startDate` (por defecto), `-startDate` o `-createdAt`; los conciertos sin fecha van al final.';

const TOUR_DERIVED = 'Sus países (`countries`) y fechas (`eventDates`) se derivan de sus conciertos publicados; nunca se editan aparte.';

@ApiTags('live-events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar conciertos', description: `Conciertos publicados; una ficha retirada solo se consulta por su id. ${EVENT_LIST}` })
  @ApiJsonApiQuery(EVENTS_QUERY)
  @ApiJsonApiCollectionResponse(EventResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(EVENTS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.events.list(query);
    return collectionDocument(eventSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un concierto',
    description:
      'Título, estado de negocio, fecha parcial, hora local y zona IANA, país, ciudad y recinto, con su tour, artistas anunciados, ' +
      'organizadores y enlaces oficiales o de entradas. `meta.editorialEntityId` es su UUID editorial. Una reserva responde 404; ' +
      'una ficha retirada solo muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'public_id del concierto' })
  @ApiJsonApiQuery(EVENT_QUERY)
  @ApiJsonApiResourceResponse(EventResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(EVENT_QUERY) query: ResourceQuery) {
    return resourceDocument(eventSchema, await this.events.show(id), query);
  }
}

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

const SCOPED =
  '`filter[status]` admite los estados de negocio; los órdenes e `include` son los de la lista general. Una ficha retirada no muestra ninguno.';

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
    description: `Conciertos publicados donde la identidad figura como organizadora. \`filter[dateFrom]\` y \`filter[dateTo]\` como en \`GET /v1/events\`. ${SCOPED}`,
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
  @ApiOperation({ summary: 'Tours que organiza una identidad', description: `Tours publicados donde la identidad figura como organizadora. ${SCOPED}` })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(SCOPED_TOURS_QUERY)
  @ApiJsonApiCollectionResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async organizedTours(@Param('id') id: string, @JsonApiQuery(SCOPED_TOURS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tours.organizedBy(id, query);
    return collectionDocument(tourSchema, entries, total, query);
  }
}

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
      `\`filter[dateFrom]\` y \`filter[dateTo]\` como en \`GET /v1/events\`. ${SCOPED}`,
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
  @ApiOperation({ summary: 'Tours de un artista', description: `Tours publicados donde el artista está anunciado. ${SCOPED}` })
  @ApiParam({ name: 'id', description: 'public_id del perfil artístico' })
  @ApiJsonApiQuery(SCOPED_TOURS_QUERY)
  @ApiJsonApiCollectionResponse(TourResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async toursOf(@Param('id') id: string, @JsonApiQuery(SCOPED_TOURS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.tours.ofArtist(id, query);
    return collectionDocument(tourSchema, entries, total, query);
  }
}
