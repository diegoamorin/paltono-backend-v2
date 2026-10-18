import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../accounts/authenticated.decorator';
import { collectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { ModerationQueueService } from './moderation-queue.service';
import { QueuedChangeResource, asProposedInformation, queuedChangeSchema } from './proposal.resource';

const QUEUE_QUERY = collectionQuery(queuedChangeSchema, {
  include: ['proposal', 'proposal.sources', 'entity'],
  sort: ['createdAt'],
  defaultSort: 'createdAt',
  filters: ['status', 'entityType', 'operation', 'author', 'entity'],
});

@ApiTags('editorial')
@Controller('moderation/changes')
export class ModerationQueueController {
  constructor(private readonly queue: ModerationQueueService) {}

  @Get()
  @Authenticated('staff')
  @ApiOperation({
    summary: 'Cola de moderación',
    description:
      'Microcambios de envíos abiertos que esperan una decisión, nunca de borradores, con su estado; el más antiguo primero. ' +
      '`filter[status]` admite `pending` y `conflicted`, separados por comas (por defecto, ambos); `filter[entityType]` y ' +
      '`filter[entity]` (UUID editorial) filtran por la raíz, `filter[operation]` por la operación y `filter[author]` por el UUID ' +
      'de la cuenta autora. Solo para moderadores y administradores.',
  })
  @ApiJsonApiQuery(QUEUE_QUERY)
  @ApiJsonApiCollectionResponse(QueuedChangeResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(QUEUE_QUERY) query: CollectionQuery) {
    const { changes, total } = await this.queue.list(query);
    return asProposedInformation(collectionDocument(queuedChangeSchema, changes, total, query));
  }
}
