import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { mixedCollectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { IdentityCreditsService } from './identity-credits.service';
import { CreditResource, recordingContributionSchema, workContributionSchema } from './music.resource';

const CREDITS_QUERY = collectionQuery(workContributionSchema, {
  alsoOf: [recordingContributionSchema],
  include: ['work', 'recording', 'role'],
  sort: ['createdAt'],
  defaultSort: 'createdAt',
  filters: ['scope', 'role'],
});

@ApiTags('music')
@Controller('identities')
export class IdentityCreditsController {
  constructor(private readonly credits: IdentityCreditsService) {}

  @Get(':id/credits')
  @ApiOperation({
    summary: 'Créditos de una identidad',
    description:
      'Documento heterogéneo con los créditos de la identidad en obras publicadas (`work-contributions`) y grabaciones publicadas ' +
      '(`recording-contributions`). `filter[scope]` admite `work`, `recording` y `release` (los créditos de ediciones llegan con ' +
      'las ediciones); `filter[role]` toma el slug de un rol musical. `include` admite `work`, `recording` y `role`. Orden ' +
      '`createdAt` (por defecto) o `-createdAt`. Una identidad retirada no muestra créditos.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(CREDITS_QUERY)
  @ApiJsonApiCollectionResponse(CreditResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(CREDITS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.credits.list(id, query);
    const resources = entries.map((model) => ({ schema: model.scope === 'work' ? workContributionSchema : recordingContributionSchema, model }));
    return mixedCollectionDocument(resources, total, query);
  }
}
