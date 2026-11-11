import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { mixedCollectionDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { IdentityCreditsService } from './identity-credits.service';
import { CreditResource, recordingContributionSchema, workContributionSchema } from './music.resource';
import { editionContributionSchema } from './release.resource';

const SCHEMAS = { work: workContributionSchema, recording: recordingContributionSchema, edition: editionContributionSchema };

const CREDITS_QUERY = collectionQuery(workContributionSchema, {
  alsoOf: [recordingContributionSchema, editionContributionSchema],
  include: ['work', 'work.firstRecording', 'work.firstRecordingArtistCredits', 'recording', 'recording.artistCredits', 'edition', 'role'],
  sort: ['createdAt', 'releaseDate'],
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
      '(`recording-contributions`) y ediciones publicadas (`edition-contributions`). `filter[scope]` admite `work`, `recording` y ' +
      '`edition`; `filter[role]` toma el slug de un rol musical. `include` admite `work`, `work.firstRecording`, ' +
      '`work.firstRecordingArtistCredits`, `recording`, `recording.artistCredits`, `edition` y `role`, para leer los créditos como ' +
      'una discografía con los artistas de cada grabación. Orden `createdAt` (por defecto), `-createdAt`, `releaseDate` o ' +
      '`-releaseDate`: la fecha de lanzamiento de lo que acredita cada crédito (la grabación, la primera grabación de la obra o la ' +
      'edición), con los créditos sin fecha al final en ambos sentidos y, entre iguales, el orden por defecto. Una identidad ' +
      'retirada no muestra créditos.',
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
