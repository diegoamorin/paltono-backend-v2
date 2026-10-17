import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication, CurrentViewer } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { ReservationDocument } from './dto/editorial-entity.dto';
import { editorialId, entityNotFound } from './editorial-access';
import { EditorialEntitiesService } from './editorial-entities.service';
import { EditorialEntityResource, editorialEntitySchema } from './editorial-entity.resource';
import { ProposalResource, asProposedInformation, publicProposalSchema } from './proposal.resource';
import { ProposalsService } from './proposals.service';

const ENTITY_QUERY = resourceQuery(editorialEntitySchema, { include: ['createdBy'] });
const HISTORY_QUERY = collectionQuery(publicProposalSchema, {
  include: ['author', 'changes', 'sources'],
  sort: ['submittedAt'],
  defaultSort: '-submittedAt',
});

@ApiTags('editorial')
@Controller('editorial-entities')
export class EditorialEntitiesController {
  constructor(
    private readonly entities: EditorialEntitiesService,
    private readonly proposals: ProposalsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Reservar una raíz para un alta',
    description:
      'Queda `reserved`, con versión 0 y sin ficha pública. Solo su autor puede proponer sobre ella, dentro de su propuesta de alta.',
  })
  @ApiJsonApiQuery(ENTITY_QUERY)
  @ApiJsonApiBody(ReservationDocument)
  @ApiJsonApiResourceResponse(EditorialEntityResource, 201)
  @ApiJsonApiErrorResponses(400, 406, 415, 422)
  async reserve(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: ReservationDocument,
    @JsonApiQuery(ENTITY_QUERY) query: ResourceQuery,
  ) {
    const entity = await this.entities.reserve(user, body.data.attributes.entityType);
    return resourceDocument(editorialEntitySchema, entity, { ...query, path: `${query.path}/${entity.id}` });
  }

  @Get(':id')
  @Authenticated('optional')
  @ApiOperation({
    summary: 'Estado editorial de una raíz',
    description: 'Tipo, estado, versión y fechas. Una reserva solo existe para su creador; cualquier otro recibe 404.',
  })
  @ApiParam({ name: 'id', description: 'UUID editorial' })
  @ApiJsonApiQuery(ENTITY_QUERY)
  @ApiJsonApiResourceResponse(EditorialEntityResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(
    @CurrentViewer() viewer: Authentication | undefined,
    @Param('id') id: string,
    @JsonApiQuery(ENTITY_QUERY) query: ResourceQuery,
  ) {
    const entity = await this.entities.show(viewer?.user, editorialId(id, entityNotFound));
    return resourceDocument(editorialEntitySchema, entity, query);
  }

  @Get(':id/proposals')
  @Authenticated('optional')
  @ApiOperation({
    summary: 'Historial público de envíos de una raíz',
    description:
      'Todos los envíos con algún microcambio sobre la raíz, también los que tengan cambios pendientes o rechazados, ' +
      'como información propuesta: sin el estado de cada microcambio, decisiones ni motivos, también para su autor. ' +
      'Nunca incluye borradores. Una reserva sin envíos solo existe para su creador.',
  })
  @ApiParam({ name: 'id', description: 'UUID editorial' })
  @ApiJsonApiQuery(HISTORY_QUERY)
  @ApiJsonApiCollectionResponse(ProposalResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async history(
    @CurrentViewer() viewer: Authentication | undefined,
    @Param('id') id: string,
    @JsonApiQuery(HISTORY_QUERY) query: CollectionQuery,
  ) {
    const { proposals, total } = await this.proposals.history(viewer?.user, editorialId(id, entityNotFound), query);
    return asProposedInformation(collectionDocument(publicProposalSchema, proposals, total, query));
  }
}
