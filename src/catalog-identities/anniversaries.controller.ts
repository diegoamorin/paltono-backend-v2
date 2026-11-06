import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { AnniversariesService } from './anniversaries.service';
import { AnniversaryResource, anniversarySchema } from './anniversary.resource';

const ANNIVERSARIES_QUERY = collectionQuery(anniversarySchema, {
  include: ['identity'],
  filters: ['month', 'day', 'kind', 'deceased', 'hasArtistProfile'],
});

@ApiTags('catalog-identities')
@Controller('anniversaries')
export class AnniversariesController {
  constructor(private readonly anniversaries: AnniversariesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar aniversarios',
    description:
      'Las fechas de las identidades publicadas, una fila por cada fecha con mes conocido: nacimientos (también sin año), fallecimientos, ' +
      'debuts, fundaciones y disoluciones. `filter[month]` admite de 1 a 12; `filter[day]`, de 1 a 31 y exige `filter[month]`, y deja fuera las ' +
      'fechas sin día; `filter[kind]`, uno o varios tipos separados por comas; `filter[deceased]`, `true` o `false`, según la identidad tenga ' +
      'un fallecimiento registrado, y `false` excluye todas sus filas, también su debut; `filter[hasArtistProfile]`, `true` o `false`. ' +
      'Orden fijo: mes, día con las fechas sin día al final de su mes, `displayName`, `kind` e identidad. No acepta `sort`.',
  })
  @ApiJsonApiQuery(ANNIVERSARIES_QUERY)
  @ApiJsonApiCollectionResponse(AnniversaryResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(ANNIVERSARIES_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.anniversaries.list(query);
    return collectionDocument(anniversarySchema, entries, total, query);
  }
}
