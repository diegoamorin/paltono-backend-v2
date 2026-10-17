import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication, CurrentViewer } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { JsonApiDocument, ResourceObject, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { NewProposalDocument, ProposalUpdateDocument, SubmissionDocument } from './dto/proposal.dto';
import { editorialId, proposalNotFound, requireMatchingId } from './editorial-access';
import { ChangeProposal } from './entities/change-proposal.entity';
import {
  ProposalResource,
  asProposedInformation,
  ProposedInformationMeta,
  publicProposalSchema,
  reviewableProposalSchema,
} from './proposal.resource';
import { ProposalInput, ProposalView, ProposalsService } from './proposals.service';

// Parsed with the reviewable schema, whose fields include the public ones.
export const PROPOSAL_QUERY = resourceQuery(reviewableProposalSchema, { include: ['author', 'changes', 'sources'] });

/** A proposal document in the viewer's projection, labelled as proposed information. */
export function proposalDocument(proposal: ChangeProposal, view: ProposalView, query: ResourceQuery): JsonApiDocument<ResourceObject> {
  const schema = view === 'reviewable' ? reviewableProposalSchema : publicProposalSchema;
  return asProposedInformation(resourceDocument(schema, proposal, query));
}

function proposalInput(body: NewProposalDocument): ProposalInput {
  const previous = body.data.relationships?.previousProposal;
  return {
    description: body.data.attributes?.description,
    previousProposalId: previous === undefined ? undefined : (previous.data?.id.toLowerCase() ?? null),
  };
}

@ApiTags('editorial')
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Crear un borrador',
    description:
      'Solo su autor puede verlo y editarlo, también frente al personal. `previousProposal` enlaza un envío propio anterior que esta propuesta corrige.',
  })
  @ApiJsonApiQuery(PROPOSAL_QUERY)
  @ApiJsonApiBody(NewProposalDocument)
  @ApiJsonApiResourceResponse(ProposalResource, 201, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 406, 415, 422)
  async create(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: NewProposalDocument,
    @JsonApiQuery(PROPOSAL_QUERY) query: ResourceQuery,
  ) {
    const proposal = await this.proposals.create(user, proposalInput(body));
    return proposalDocument(proposal, 'reviewable', { ...query, path: `${query.path}/${proposal.id}` });
  }

  @Get(':id')
  @Authenticated('optional')
  @ApiOperation({
    summary: 'Ver una propuesta',
    description:
      'Un envío es público como información propuesta: autor, fechas, descripción, operaciones, valores propuestos y fuentes, ' +
      'sin el estado de cada microcambio ni decisiones. Su autor y el personal ven además los estados. ' +
      'Un borrador solo existe para su autor; cualquier otra cuenta, incluido el personal, recibe 404.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(PROPOSAL_QUERY)
  @ApiJsonApiResourceResponse(ProposalResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(
    @CurrentViewer() viewer: Authentication | undefined,
    @Param('id') id: string,
    @JsonApiQuery(PROPOSAL_QUERY) query: ResourceQuery,
  ) {
    const { proposal, view } = await this.proposals.show(viewer?.user, editorialId(id, proposalNotFound));
    return proposalDocument(proposal, view, query);
  }

  @Patch(':id')
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Editar un borrador',
    description: 'Descripción y propuesta anterior. Solo su autor y solo en `draft`; un envío responde 409.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(PROPOSAL_QUERY)
  @ApiJsonApiBody(ProposalUpdateDocument)
  @ApiJsonApiResourceResponse(ProposalResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async update(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: ProposalUpdateDocument,
    @JsonApiQuery(PROPOSAL_QUERY) query: ResourceQuery,
  ) {
    const proposalId = editorialId(id, proposalNotFound);
    requireMatchingId(body.data.id, proposalId);
    const proposal = await this.proposals.update(user, proposalId, proposalInput(body));
    return proposalDocument(proposal, 'reviewable', query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Descartar un borrador',
    description: 'Borra el borrador con sus microcambios y fuentes. No es una decisión de moderación. Un envío responde 409.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiErrorResponses(404, 406, 409)
  async discard(@CurrentAuthentication() { user }: Authentication, @Param('id') id: string): Promise<void> {
    await this.proposals.discard(user, editorialId(id, proposalNotFound));
  }

  @Post(':id/submission')
  @HttpCode(HttpStatus.OK)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Enviar un borrador',
    description:
      'Exige descripción, al menos un microcambio, una fuente general y payloads válidos. Después autor, descripción, ' +
      'operaciones, orden y fuentes quedan congelados: editarlos responde 409. Los errores de cada microcambio llevan su id en `meta.changeId`.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(PROPOSAL_QUERY)
  @ApiJsonApiBody(SubmissionDocument)
  @ApiJsonApiResourceResponse(ProposalResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async submit(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() _body: SubmissionDocument,
    @JsonApiQuery(PROPOSAL_QUERY) query: ResourceQuery,
  ) {
    const proposal = await this.proposals.submit(user, editorialId(id, proposalNotFound));
    return proposalDocument(proposal, 'reviewable', { ...query, path: `/v1/proposals/${proposal.id}` });
  }
}
