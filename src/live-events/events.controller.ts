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
import { EventResource, eventSchema } from './live-event.resource';

const EVENT_INCLUDE = ['tour', 'artists', 'artists.artist', 'organizers', 'organizers.identity', 'links', 'country'];

export const EVENTS_OPTIONS: CollectionQueryOptions = { include: EVENT_INCLUDE, sort: ['startDate', 'createdAt'], defaultSort: 'startDate' };

export const EVENT_FILTERS = ['q', 'status', 'country', 'city', 'artist', 'organizer', 'tour', 'dateFrom', 'dateTo'];
const EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: EVENT_FILTERS });
/** The concerts of an identity or an artist. */
export const SCOPED_EVENTS_QUERY = collectionQuery(eventSchema, { ...EVENTS_OPTIONS, filters: ['status', 'dateFrom', 'dateTo'] });
const EVENT_QUERY = resourceQuery(eventSchema, { include: EVENT_INCLUDE });

export const EVENT_LIST =
  '`filter[q]` busca en el título, el recinto y la ciudad sin distinguir mayúsculas ni acentos; `filter[status]` admite ' +
  '`announced`, `scheduled`, `postponed`, `cancelled` y `performed`; `filter[country]` toma un código de país; `filter[city]`, ' +
  'una ciudad exacta sin distinguir mayúsculas ni acentos; `filter[artist]`, el public_id de un artista anunciado; ' +
  '`filter[organizer]`, el de una identidad organizadora; `filter[tour]`, el de un tour. `filter[dateFrom]` y `filter[dateTo]` ' +
  '(YYYY, YYYY-MM o YYYY-MM-DD) incluyen una fecha parcial que se solapa con el rango y excluyen los conciertos sin fecha. ' +
  'Orden `startDate` (por defecto), `-startDate` o `-createdAt`; los conciertos sin fecha van al final.';

/** How the lists of concerts and tours of an identity or an artist are filtered. */
export const SCOPED_LIST =
  '`filter[status]` admite los estados de negocio; los órdenes e `include` son los de la lista general. Una ficha retirada no muestra ninguno.';

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
