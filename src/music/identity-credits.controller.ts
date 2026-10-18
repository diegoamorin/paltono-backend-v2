import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { mixedCollectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { IdentityCreditsService } from './identity-credits.service';
import { CreditResource, recordingContributionSchema, workContributionSchema } from './music.resource';
import { releaseContributionSchema } from './release.resource';

const SCHEMAS = { work: workContributionSchema, recording: recordingContributionSchema, release: releaseContributionSchema };

const CREDITS_QUERY = collectionQuery(workContributionSchema, {
  alsoOf: [recordingContributionSchema, releaseContributionSchema],
  include: ['work', 'recording', 'release', 'role'],
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
      'Documento heterogéneo con los créditos de la identidad en obras publicadas (`work-contributions`), grabaciones publicadas ' +
      '(`recording-contributions`) y ediciones publicadas (`release-contributions`). `filter[scope]` admite `work`, `recording` y ' +
      '`release`; `filter[role]` toma el slug de un rol musical. `include` admite `work`, `recording`, `release` y `role`. Orden ' +
      '`createdAt` (por defecto) o `-createdAt`. Una identidad retirada no muestra créditos.',
  })
  @ApiParam({ name: 'id', description: 'public_id de la identidad' })
  @ApiJsonApiQuery(CREDITS_QUERY)
  @ApiJsonApiCollectionResponse(CreditResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(CREDITS_QUERY) query: CollectionQuery) {
    const { entries, total } = await this.credits.list(id, query);
    const resources = entries.map((model) => ({ schema: SCHEMAS[model.scope], model }));
    return mixedCollectionDocument(resources, total, query);
  }
}
