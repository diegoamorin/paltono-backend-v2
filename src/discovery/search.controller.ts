import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArtistResource } from '../catalog-identities/artist.resource';
import { IdentityResource } from '../catalog-identities/identity.resource';
import { mixedCollectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { EventResource, TourResource } from '../live-events/live-event.resource';
import { RecordingResource, WorkResource } from '../music/music.resource';
import { ReleaseResource } from '../music/release.resource';
import { SOURCES, SearchService } from './search.service';

const [FIRST, ...OTHERS] = SOURCES;

const SEARCH_QUERY = collectionQuery(FIRST.schema, {
  alsoOf: OTHERS.map(({ schema }) => schema),
  // Only recordings and releases have them; other results ignore the include.
  include: ['artistCredits', 'artistCredits.artist'],
  sort: ['relevance'],
  defaultSort: '-relevance',
  filters: ['q', 'type'],
});

/** The resource objects of the types search finds, as Swagger describes them. */
const RESULT_RESOURCES = [IdentityResource, ArtistResource, WorkResource, RecordingResource, ReleaseResource, EventResource, TourResource];

@ApiTags('discovery')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Búsqueda global',
    description:
      'Documento heterogéneo de fichas publicadas cuyo nombre visible, alias o título coincide con `filter[q]` (obligatorio), por ' +
      'relevancia. No distingue mayúsculas ni acentos; encuentra un texto contenido en un nombre, también en coreano, y tolera ' +
      'errores de escritura en romanizaciones. No translitera: «블랙핑크» no encuentra «BLACKPINK» salvo que sea uno de sus alias. ' +
      '`filter[type]` limita los tipos, separados por comas: `identities`, `artists`, `works`, `recordings`, `releases`, ' +
      '`events` y `tours`; sin él se buscan todos salvo `artists`, porque un perfil artístico forma parte de la ficha de su ' +
      'identidad. Devuelve lanzamientos, no ediciones: el título propio de una edición encuentra su lanzamiento, una sola vez. ' +
      'Excluye reservas y fichas retiradas. Orden `-relevance` (por defecto) o `relevance`. `include` admite `artistCredits` y ' +
      '`artistCredits.artist`, que se aplican a `recordings` y `releases`, con el nombre listo para mostrar en `displayName`.',
  })
  @ApiJsonApiQuery(SEARCH_QUERY)
  @ApiJsonApiCollectionResponse(RESULT_RESOURCES)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(SEARCH_QUERY) query: CollectionQuery) {
    const { results, total } = await this.search.search(query);
    return mixedCollectionDocument(results, total, query);
  }
}
