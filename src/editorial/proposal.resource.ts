import { ApiProperty } from '@nestjs/swagger';
import { AccountLinkage, publicAccountSchema } from '../accounts/account.resource';
import { defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { editorialEntitySchema } from './editorial-entity.resource';
import { ChangeProposal, PROPOSAL_STATUSES } from './entities/change-proposal.entity';
import { CHANGE_OPERATIONS, CHANGE_STATUSES, ProposalChange } from './entities/proposal-change.entity';
import { ProposalSource } from './entities/proposal-source.entity';

/*
 * Two projections of a proposal, both built here on the server:
 * - the public one, for any visitor, shows what was proposed (author, dates,
 *   description, operations, proposed values and sources) and never the
 *   outcome of each microchange;
 * - the reviewable one, for its author and for staff, adds the state and
 *   resolution date of each microchange.
 * Every document carrying either is labelled as proposed information.
 */

/** Document-level `meta` that labels proposals as proposed information, apart from the current entries. */
export const PROPOSED_INFORMATION = { informationKind: 'proposed' } as const;

/** Labels a document of proposals or of their parts as proposed information. */
export function asProposedInformation<D extends { meta?: Record<string, unknown> }>(document: D): D {
  return { ...document, meta: { ...document.meta, ...PROPOSED_INFORMATION } };
}

export class ProposedInformationMeta {
  @ApiProperty({ enum: ['proposed'], description: 'Información propuesta, separada de la ficha vigente' })
  informationKind: string;
}

export const proposalSourceSchema = defineResource<ProposalSource>({
  type: 'proposal-sources',
  id: (source) => source.id,
  attributes: {
    url: (source) => source.url,
    citationText: (source) => source.citationText,
    createdAt: (source) => source.createdAt.toISOString(),
  },
});

/** Only the identity of the root a microchange targets: its state is read from E3, where reservations stay private. */
const entityIdentitySchema = defineResource<{ id: string }>({ type: 'editorial-entities', id: (entity) => entity.id, attributes: {} });

const proposedAttributes = {
  operation: (change: ProposalChange) => change.operation,
  targetPath: (change: ProposalChange) => change.targetPath,
  targetKey: (change: ProposalChange) => change.targetKey,
  payloadSchemaVersion: (change: ProposalChange) => change.payloadSchemaVersion,
  baseVersion: (change: ProposalChange) => change.baseVersion,
  baseValue: (change: ProposalChange) => change.baseValue,
  proposedValue: (change: ProposalChange) => change.proposedValue,
  atomicGroupId: (change: ProposalChange) => change.atomicGroupId,
  position: (change: ProposalChange) => change.position,
  createdAt: (change: ProposalChange) => change.createdAt.toISOString(),
};

const changeIdentitySchema = defineResource<{ id: string }>({ type: 'proposal-changes', id: (change) => change.id, attributes: {} });
const sourceIdentitySchema = defineResource<{ id: string }>({ type: 'proposal-sources', id: (source) => source.id, attributes: {} });

/** Dependencies and linked sources are part of the frozen content, so both projections show them. */
const changeRelationships = {
  entity: { schema: () => entityIdentitySchema, get: (change: ProposalChange) => ({ id: change.entityId }) },
  dependencies: { schema: () => changeIdentitySchema, get: (change: ProposalChange) => change.dependsOnIds?.map((id) => ({ id })) },
  sources: { schema: () => sourceIdentitySchema, get: (change: ProposalChange) => change.sourceIds?.map((id) => ({ id })) },
};

export const publicChangeSchema = defineResource<ProposalChange>({
  type: 'proposal-changes',
  id: (change) => change.id,
  attributes: proposedAttributes,
  relationships: changeRelationships,
});

export const reviewableChangeSchema = defineResource<ProposalChange>({
  type: 'proposal-changes',
  id: (change) => change.id,
  attributes: {
    ...proposedAttributes,
    status: (change) => change.status,
    resolvedAt: (change) => change.resolvedAt?.toISOString() ?? null,
    payloadSchemaStatus: (change) => change.payloadSchemaStatus,
  },
  relationships: changeRelationships,
});

const proposalAttributes = {
  description: (proposal: ChangeProposal) => proposal.description,
  status: (proposal: ChangeProposal) => proposal.status,
  createdAt: (proposal: ChangeProposal) => proposal.createdAt.toISOString(),
  updatedAt: (proposal: ChangeProposal) => proposal.updatedAt.toISOString(),
  submittedAt: (proposal: ChangeProposal) => proposal.submittedAt?.toISOString() ?? null,
  closedAt: (proposal: ChangeProposal) => proposal.closedAt?.toISOString() ?? null,
};

const previousProposalSchema = defineResource<{ id: string }>({ type: 'proposals', id: (proposal) => proposal.id, attributes: {} });

function proposalRelationships(changeSchema: typeof publicChangeSchema) {
  return {
    author: { schema: () => publicAccountSchema, get: (proposal: ChangeProposal) => proposal.author },
    previousProposal: {
      schema: () => previousProposalSchema,
      get: (proposal: ChangeProposal) => (proposal.previousProposalId ? { id: proposal.previousProposalId } : null),
    },
    changes: { schema: () => changeSchema, get: (proposal: ChangeProposal) => proposal.changes },
    sources: { schema: () => proposalSourceSchema, get: (proposal: ChangeProposal) => proposal.sources },
  };
}

export const publicProposalSchema = defineResource<ChangeProposal>({
  type: 'proposals',
  id: (proposal) => proposal.id,
  attributes: proposalAttributes,
  relationships: proposalRelationships(publicChangeSchema),
});

export const reviewableProposalSchema = defineResource<ChangeProposal>({
  type: 'proposals',
  id: (proposal) => proposal.id,
  attributes: proposalAttributes,
  relationships: proposalRelationships(reviewableChangeSchema),
});

/**
 * A microchange in the moderation queue: the reviewable projection, with its
 * proposal and the editorial state of its root, which only staff read there.
 */
export const queuedChangeSchema = defineResource<ProposalChange>({
  type: 'proposal-changes',
  id: (change) => change.id,
  attributes: reviewableChangeSchema.attributes,
  relationships: {
    ...changeRelationships,
    entity: { schema: () => editorialEntitySchema, get: (change: ProposalChange) => change.entity },
    proposal: { schema: () => reviewableProposalSchema, get: (change: ProposalChange) => change.proposal },
  },
});

class ProposalAttributes {
  @ApiProperty({ description: 'Puede estar vacía en un borrador; un envío siempre la tiene' })
  description: string;

  @ApiProperty({ enum: PROPOSAL_STATUSES, description: '`draft` solo lo ve su autor; `open` mientras quede un microcambio por resolver' })
  status: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt: string | null;
}

class ProposalLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

class ProposalLinkages {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}

class ProposalRelationships {
  @ApiProperty({ type: AccountLinkage })
  author: AccountLinkage;

  @ApiProperty({ type: ProposalLinkage, description: 'Envío anterior que esta propuesta corrige' })
  previousProposal: ProposalLinkage;

  @ApiProperty({ type: ProposalLinkages, required: false, description: 'Con include=changes' })
  changes?: ProposalLinkages;

  @ApiProperty({ type: ProposalLinkages, required: false, description: 'Con include=sources' })
  sources?: ProposalLinkages;
}

export class ProposalResource {
  @ApiProperty({ enum: ['proposals'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ProposalAttributes })
  attributes: ProposalAttributes;

  @ApiProperty({ type: ProposalRelationships })
  relationships: ProposalRelationships;
}

class ChangeAttributes {
  @ApiProperty({ enum: CHANGE_OPERATIONS })
  operation: string;

  @ApiProperty({ example: 'catalog_identities' })
  targetPath: string;

  @ApiProperty({ type: Object, nullable: true })
  targetKey: object | null;

  @ApiProperty({ example: 1 })
  payloadSchemaVersion: number;

  @ApiProperty({ description: 'Versión publicada de la raíz que vio el autor; 0 en una reserva' })
  baseVersion: number;

  @ApiProperty({ type: Object, example: { exists: false } })
  baseValue: object;

  @ApiProperty({ type: Object, description: 'Valor propuesto: `{"exists": true, "value": ...}`' })
  proposedValue: object;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  atomicGroupId: string | null;

  @ApiProperty({ description: 'Orden estable dentro de la propuesta' })
  position: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ enum: CHANGE_STATUSES, required: false, description: 'Solo para su autor y el personal' })
  status?: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, required: false, description: 'Solo para su autor y el personal' })
  resolvedAt?: string | null;

  @ApiProperty({
    enum: ['current', 'obsolete'],
    required: false,
    description:
      'Solo para su autor y el personal. obsolete: su versión del payload ya no es la vigente (E1); en un borrador hay que quitarlo o rehacerlo antes de enviar',
  })
  payloadSchemaStatus?: string;
}

class EntityLinkage {
  @ApiProperty({ type: ResourceIdentifier })
  data: ResourceIdentifier;
}

class ChangeRelationships {
  @ApiProperty({ type: EntityLinkage })
  entity: EntityLinkage;

  @ApiProperty({ type: ProposalLinkages, description: 'Microcambios de la misma propuesta de los que depende' })
  dependencies: ProposalLinkages;

  @ApiProperty({ type: ProposalLinkages, description: 'Fuentes generales de la propuesta vinculadas a este microcambio' })
  sources: ProposalLinkages;
}

class QueuedChangeRelationships extends ChangeRelationships {
  @ApiProperty({ type: EntityLinkage, description: 'Propuesta del microcambio' })
  proposal: EntityLinkage;
}

export class QueuedChangeResource {
  @ApiProperty({ enum: ['proposal-changes'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ChangeAttributes })
  attributes: ChangeAttributes;

  @ApiProperty({ type: QueuedChangeRelationships })
  relationships: QueuedChangeRelationships;
}

export class ProposalChangeResource {
  @ApiProperty({ enum: ['proposal-changes'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ChangeAttributes })
  attributes: ChangeAttributes;

  @ApiProperty({ type: ChangeRelationships })
  relationships: ChangeRelationships;
}

class SourceAttributes {
  @ApiProperty({ type: String, nullable: true, example: 'https://es.wikipedia.org/wiki/IU_(cantante)' })
  url: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Referencia bibliográfica, página o contexto' })
  citationText: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ProposalSourceResource {
  @ApiProperty({ enum: ['proposal-sources'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: SourceAttributes })
  attributes: SourceAttributes;
}
