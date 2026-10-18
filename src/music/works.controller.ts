import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { RecordingResource, WorkResource, recordingSchema, workSchema } from './music.resource';
import { RECORDINGS_OPTIONS } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { WorksService } from './works.service';

const INCLUDE = ['contributions', 'contributions.identity', 'contributions.role', 'recordingWorks', 'recordingWorks.recording'];

const WORK_QUERY = resourceQuery(workSchema, { include: INCLUDE });

const WORKS_QUERY = collectionQuery(workSchema, {
  include: INCLUDE,
  sort: ['title', 'createdAt'],
  defaultSort: 'title',
  filters: ['q', 'slug', 'iswc', 'contributor', 'role'],
});

const WORK_RECORDINGS_QUERY = collectionQuery(recordingSchema, { ...RECORDINGS_OPTIONS, filters: ['relationType'] });

@ApiTags('music')
@Controller('works')
export class WorksController {
  constructor(
    private readonly works: WorksService,
    private readonly recordings: RecordingsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar obras',
    description:
      'Obras publicadas; una ficha retirada solo se consulta por su id. `filter[q]` busca en el título sin distinguir mayúsculas ni ' +
      'acentos; `filter[slug]` resuelve una obra por su slug; `filter[iswc]` toma el ISWC canónico; `filter[contributor]`, el ' +
      'public_id de una identidad acreditada, y `filter[role]`, el slug de un rol musical (juntos, en el mismo crédito). ' +
      'Orden `title` (por defecto) o `-createdAt`.',
  })
  @ApiJsonApiQuery(WORKS_QUERY)
  @ApiJsonApiCollectionResponse(WorkResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(WORKS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.works.list(query);
    return collectionDocument(workSchema, entries, total, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver una obra',
    description:
      'Título, slug, descripción e ISWC, con sus créditos y las grabaciones que la interpretan, interpolan o samplean. ' +
      '`meta.editorialEntityId` es su UUID editorial. Una reserva no existe: responde 404. Una ficha retirada solo muestra su aviso.',
  })
  @ApiParam({ name: 'id', description: 'id de la obra' })
  @ApiJsonApiQuery(WORK_QUERY)
  @ApiJsonApiResourceResponse(WorkResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(WORK_QUERY) query: ResourceQuery) {
    return resourceDocument(workSchema, await this.works.show(id), query);
  }

  @Get(':id/recordings')
  @ApiOperation({
    summary: 'Grabaciones de una obra',
    description:
      'Grabaciones publicadas que interpretan, interpolan o samplean la obra; `filter[relationType]` admite `performance`, ' +
      '`interpolation` y `sample`. `include=recordingWorks` muestra la relación de cada una. Una obra retirada no muestra ninguna.',
  })
  @ApiParam({ name: 'id', description: 'id de la obra' })
  @ApiJsonApiQuery(WORK_RECORDINGS_QUERY)
  @ApiJsonApiCollectionResponse(RecordingResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async recordingsOf(@Param('id') id: string, @JsonApiQuery(WORK_RECORDINGS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.recordings.ofWork(id, query);
    return collectionDocument(recordingSchema, entries, total, query);
  }
}
