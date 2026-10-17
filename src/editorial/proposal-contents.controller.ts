import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication, CurrentViewer } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { collectionDocument, pageWindow, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { ChangeUpdateDocument, NewChangeDocument } from './dto/proposal-change.dto';
import { NewSourceDocument, SourceUpdateDocument } from './dto/proposal-source.dto';
import { changeNotFound, editorialId, proposalNotFound, requireMatchingId, sourceNotFound } from './editorial-access';
import { ProposalChangesService } from './proposal-changes.service';
import { ProposalSourcesService } from './proposal-sources.service';
import {
  ProposalChangeResource,
  ProposalSourceResource,
  ProposedInformationMeta,
  asProposedInformation,
  proposalSourceSchema,
  publicChangeSchema,
  reviewableChangeSchema,
} from './proposal.resource';
import { ProposalsService } from './proposals.service';

const CHANGE_QUERY = resourceQuery(reviewableChangeSchema);
const CHANGES_QUERY = collectionQuery(reviewableChangeSchema, { sort: ['position'], defaultSort: 'position' });
const SOURCE_QUERY = resourceQuery(proposalSourceSchema);

@ApiTags('editorial')
@Controller('proposals/:id/changes')
export class ProposalChangesController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly changes: ProposalChangesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Añadir un microcambio a un borrador',
    description:
      'Operación, raíz, selector y payload deben ser una entrada del registro E1, que valida `proposedValue`. ' +
      'Sobre una reserva solo propone su autor, y solo la primera propuesta que la envía. La base de un alta es `{"exists": false}` en la versión 0.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(CHANGE_QUERY)
  @ApiJsonApiBody(NewChangeDocument)
  @ApiJsonApiResourceResponse(ProposalChangeResource, 201, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async add(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: NewChangeDocument,
    @JsonApiQuery(CHANGE_QUERY) query: ResourceQuery,
  ) {
    const { attributes, relationships } = body.data;
    const change = await this.changes.add(user, editorialId(id, proposalNotFound), {
      ...attributes,
      entityId: relationships.entity.data.id,
    });
    const path = `${query.path}/${change.id}`;
    return asProposedInformation(resourceDocument(reviewableChangeSchema, change, { ...query, path }));
  }

  @Get()
  @Authenticated('optional')
  @ApiOperation({
    summary: 'Listar los microcambios de una propuesta',
    description: 'Como E8: proyección pública de un envío, con estados para su autor y el personal; un borrador solo para su autor.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(CHANGES_QUERY)
  @ApiJsonApiCollectionResponse(ProposalChangeResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(
    @CurrentViewer() viewer: Authentication | undefined,
    @Param('id') id: string,
    @JsonApiQuery(CHANGES_QUERY) query: CollectionQuery,
  ) {
    const { proposal, view } = await this.proposals.show(viewer?.user, editorialId(id, proposalNotFound));
    const changes = proposal.changes!;
    if (query.sort[0].direction === 'DESC') changes.reverse();
    const { skip, take } = pageWindow(query);
    const schema = view === 'reviewable' ? reviewableChangeSchema : publicChangeSchema;
    return asProposedInformation(collectionDocument(schema, changes.slice(skip, skip + take), changes.length, query));
  }

  @Patch(':changeId')
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Editar un microcambio de un borrador',
    description: 'Payload, versión del payload, grupo atómico y posición, validados como al añadirlo. Un envío responde 409.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiParam({ name: 'changeId', description: 'UUID del microcambio' })
  @ApiJsonApiQuery(CHANGE_QUERY)
  @ApiJsonApiBody(ChangeUpdateDocument)
  @ApiJsonApiResourceResponse(ProposalChangeResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async update(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Param('changeId') changeId: string,
    @Body() body: ChangeUpdateDocument,
    @JsonApiQuery(CHANGE_QUERY) query: ResourceQuery,
  ) {
    const proposalId = editorialId(id, proposalNotFound);
    const ownChangeId = editorialId(changeId, changeNotFound);
    requireMatchingId(body.data.id, ownChangeId);
    const change = await this.changes.update(user, proposalId, ownChangeId, body.data.attributes ?? {});
    return asProposedInformation(resourceDocument(reviewableChangeSchema, change, query));
  }

  @Delete(':changeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated('verified')
  @ApiOperation({ summary: 'Quitar un microcambio de un borrador', description: 'Un envío responde 409.' })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiParam({ name: 'changeId', description: 'UUID del microcambio' })
  @ApiJsonApiErrorResponses(404, 406, 409)
  async remove(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Param('changeId') changeId: string) {
    await this.changes.remove(user, editorialId(id, proposalNotFound), editorialId(changeId, changeNotFound));
  }
}

@ApiTags('editorial')
@Controller('proposals/:id/sources')
export class ProposalSourcesController {
  constructor(private readonly sources: ProposalSourcesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Añadir una fuente general a un borrador',
    description: 'Una URL HTTP(S), una referencia bibliográfica o ambas. Un envío responde 409.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(SOURCE_QUERY)
  @ApiJsonApiBody(NewSourceDocument)
  @ApiJsonApiResourceResponse(ProposalSourceResource, 201, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async add(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: NewSourceDocument,
    @JsonApiQuery(SOURCE_QUERY) query: ResourceQuery,
  ) {
    const source = await this.sources.add(user, editorialId(id, proposalNotFound), body.data.attributes);
    const path = `${query.path}/${source.id}`;
    return asProposedInformation(resourceDocument(proposalSourceSchema, source, { ...query, path }));
  }

  @Patch(':sourceId')
  @Authenticated('verified')
  @ApiOperation({ summary: 'Editar una fuente de un borrador', description: 'Debe conservar una URL o una cita. Un envío responde 409.' })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiParam({ name: 'sourceId', description: 'UUID de la fuente' })
  @ApiJsonApiQuery(SOURCE_QUERY)
  @ApiJsonApiBody(SourceUpdateDocument)
  @ApiJsonApiResourceResponse(ProposalSourceResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async update(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() body: SourceUpdateDocument,
    @JsonApiQuery(SOURCE_QUERY) query: ResourceQuery,
  ) {
    const ownSourceId = editorialId(sourceId, sourceNotFound);
    requireMatchingId(body.data.id, ownSourceId);
    const source = await this.sources.update(user, editorialId(id, proposalNotFound), ownSourceId, body.data.attributes);
    return asProposedInformation(resourceDocument(proposalSourceSchema, source, query));
  }

  @Delete(':sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated('verified')
  @ApiOperation({ summary: 'Quitar una fuente de un borrador', description: 'Un envío responde 409.' })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiParam({ name: 'sourceId', description: 'UUID de la fuente' })
  @ApiJsonApiErrorResponses(404, 406, 409)
  async remove(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string, @Param('sourceId') sourceId: string) {
    await this.sources.remove(user, editorialId(id, proposalNotFound), editorialId(sourceId, sourceNotFound));
  }
}
