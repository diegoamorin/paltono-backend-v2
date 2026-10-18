import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { accountId } from '../accounts/administration';
import { Authenticated, CurrentAuthentication, CurrentViewer } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { JsonApiDocument, ResourceObject, collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { DecisionsService } from './decisions.service';
import { NewProposalDocument, ProposalUpdateDocument, PublicationDocument, SubmissionDocument } from './dto/proposal.dto';
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
  constructor(
    private readonly proposals: ProposalsService,
    private readonly decisions: DecisionsService,
  ) {}

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
      'Exige descripción, al menos un microcambio, una fuente general, payloads válidos y dependencias sin ciclos, contando las que ' +
      'implican las referencias de cada clave y colapsando los grupos atómicos. Después autor, descripción, operaciones, orden, grupos, ' +
      'dependencias y fuentes quedan congelados: editarlos responde 409. Los errores de cada microcambio llevan su id en `meta.changeId`.',
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

  @Post(':id/publication')
  @HttpCode(HttpStatus.OK)
  @Authenticated('staff')
  @ApiOperation({
    summary: 'Publicar directamente un borrador propio',
    description:
      'Solo moderadores y administradores, sobre un borrador propio. Lo envía con las mismas validaciones que un envío y aplica ' +
      'todos sus microcambios en orden de dependencias, en una sola transacción: queda una propuesta enviada y cerrada, con sus ' +
      'fuentes, una decisión `apply` por microcambio, cuyo actor es el propio autor, y sus revisiones. Si algún microcambio no ' +
      'puede aplicarse (base cambiada, restricción, dependencia), no se envía ni se aplica nada y el borrador sigue igual. ' +
      'Retirar una ficha publicada exige un administrador.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la propuesta' })
  @ApiJsonApiQuery(PROPOSAL_QUERY)
  @ApiJsonApiBody(PublicationDocument)
  @ApiJsonApiResourceResponse(ProposalResource, 200, ProposedInformationMeta)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async publish(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() _body: PublicationDocument,
    @JsonApiQuery(PROPOSAL_QUERY) query: ResourceQuery,
  ) {
    const proposal = await this.decisions.publish(user, editorialId(id, proposalNotFound));
    return proposalDocument(proposal, 'reviewable', { ...query, path: `/v1/proposals/${proposal.id}` });
  }
}

const OWN_PROPOSALS_QUERY = collectionQuery(reviewableProposalSchema, {
  include: ['author', 'changes', 'sources'],
  sort: ['submittedAt', 'updatedAt'],
  defaultSort: '-updatedAt',
  filters: ['status', 'entity', 'entityType'],
});

@ApiTags('editorial')
@Controller('me/proposals')
export class OwnProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Mis propuestas',
    description:
      'Las propuestas propias, incluidos los borradores, con el estado de cada microcambio. `filter[status]` admite ' +
      '`draft`, `open` y `closed`, separados por comas; `filter[entity]` es el UUID editorial de una raíz sobre la que ' +
      'propone algún microcambio y `filter[entityType]`, su tipo. Orden `-updatedAt` (por defecto) o `-submittedAt`.',
  })
  @ApiJsonApiQuery(OWN_PROPOSALS_QUERY)
  @ApiJsonApiCollectionResponse(ProposalResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@CurrentAuthentication() { user }: Authentication, @JsonApiQuery(OWN_PROPOSALS_QUERY) query: CollectionQuery) {
    // The matrix lists these sorts newest first only.
    if (query.sort.some(({ field, direction }) => field !== 'id' && direction === 'ASC')) {
      throw new JsonApiException(HttpStatus.BAD_REQUEST, [
        { detail: 'sort must list fields among: -submittedAt, -updatedAt', source: { parameter: 'sort' } },
      ]);
    }
    const { proposals, total } = await this.proposals.listOwn(user, query);
    return asProposedInformation(collectionDocument(reviewableProposalSchema, proposals, total, query));
  }
}

const ACCOUNT_PROPOSALS_QUERY = collectionQuery(publicProposalSchema, {
  include: ['author', 'changes', 'sources'],
  sort: ['submittedAt'],
  defaultSort: '-submittedAt',
  filters: ['status', 'entityType'],
});

@ApiTags('accounts')
@Controller('users/:id/proposals')
export class AccountProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @ApiOperation({
    summary: 'Envíos públicos de una cuenta',
    description:
      'Los envíos de la cuenta como información propuesta, sin el estado de cada microcambio ni decisiones, para cualquiera; ' +
      'nunca sus borradores. Siguen visibles si la cuenta está suspendida o eliminada. `filter[status]` admite `open` y ' +
      '`closed`, separados por comas, y `filter[entityType]` el tipo de alguna raíz propuesta.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(ACCOUNT_PROPOSALS_QUERY)
  @ApiJsonApiCollectionResponse(ProposalResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(ACCOUNT_PROPOSALS_QUERY) query: CollectionQuery) {
    const { proposals, total } = await this.proposals.listSubmissions(accountId(id), query);
    return asProposedInformation(collectionDocument(publicProposalSchema, proposals, total, query));
  }
}
