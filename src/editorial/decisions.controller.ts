import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { collectionDocument, resourcesDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourcesResponse,
} from '../common/json-api/swagger';
import { ChangeDecisionResource, changeDecisionSchema } from './change-decision.resource';
import { DecisionsService } from './decisions.service';
import { DecisionDocument } from './dto/change-decision.dto';
import { changeNotFound, editorialId } from './editorial-access';

const DECISION_QUERY = resourceQuery(changeDecisionSchema, { include: ['actor', 'revision'] });
const DECISIONS_QUERY = collectionQuery(changeDecisionSchema, {
  include: ['actor', 'revision'],
  sort: ['decidedAt'],
  defaultSort: 'decidedAt',
});

@ApiTags('editorial')
@Controller('proposal-changes/:id/decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Decidir un microcambio',
    description:
      'Solo moderadores y administradores activos; el permiso se vuelve a comprobar dentro de la transacción. ' +
      '`apply` valida de nuevo el payload y lo incorpora a la ficha: al aplicar un alta se inserta la identidad, se publica la raíz ' +
      'y se escriben la decisión y la primera revisión, todo en una transacción. `reject` exige motivo; una reserva rechazada sigue sin ficha pública. ' +
      'Un microcambio ya resuelto responde 409. La propuesta se cierra cuando todos sus microcambios quedan resueltos. ' +
      'Devuelve las decisiones tomadas; `include=revision` añade la revisión con `resultKey.publicId` de la ficha creada.',
  })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiQuery(DECISION_QUERY)
  @ApiJsonApiBody(DecisionDocument)
  @ApiJsonApiResourcesResponse(ChangeDecisionResource, 201)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async decide(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: DecisionDocument,
    @JsonApiQuery(DECISION_QUERY) query: ResourceQuery,
  ) {
    const decisions = await this.decisions.decide(user, editorialId(id, changeNotFound), body.data.attributes);
    return resourcesDocument(changeDecisionSchema, decisions, query);
  }

  @Get()
  @Authenticated('authenticated')
  @ApiOperation({
    summary: 'Historial de decisiones de un microcambio',
    description:
      'Incluye las decisiones automáticas, cuyo `actor` es null. Solo lo ven el autor del microcambio y el personal; ' +
      'cualquier otra cuenta recibe 403. Un microcambio de un borrador no existe.',
  })
  @ApiParam({ name: 'id', description: 'UUID del microcambio' })
  @ApiJsonApiQuery(DECISIONS_QUERY)
  @ApiJsonApiCollectionResponse(ChangeDecisionResource)
  @ApiJsonApiErrorResponses(400, 403, 404, 406)
  async history(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @JsonApiQuery(DECISIONS_QUERY) query: CollectionQuery,
  ) {
    const { decisions, total } = await this.decisions.history(user, editorialId(id, changeNotFound), query);
    return collectionDocument(changeDecisionSchema, decisions, total, query);
  }
}
