import { ApiProperty } from '@nestjs/swagger';
import { publicAccountSchema } from '../accounts/account.resource';
import { defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { ChangeDecision, DECISION_ACTIONS } from './entities/change-decision.entity';
import { CHANGE_STATUSES } from './entities/proposal-change.entity';
import { EntityRevision } from './entities/entity-revision.entity';

/*
 * Decisions and revisions are review data: only the author of the microchange
 * and staff read them, never the public projection of a proposal.
 */

const changeIdentitySchema = defineResource<{ id: string }>({ type: 'proposal-changes', id: (change) => change.id, attributes: {} });
const entityIdentitySchema = defineResource<{ id: string }>({ type: 'editorial-entities', id: (entity) => entity.id, attributes: {} });

export const entityRevisionSchema = defineResource<EntityRevision>({
  type: 'entity-revisions',
  id: (revision) => revision.id,
  attributes: {
    version: (revision) => revision.version,
    beforeValue: (revision) => revision.beforeValue,
    afterValue: (revision) => revision.afterValue,
    resultKey: (revision) => revision.resultKey,
    appliedAt: (revision) => revision.appliedAt.toISOString(),
  },
  relationships: {
    entity: { schema: () => entityIdentitySchema, get: (revision) => ({ id: revision.entityId }) },
    change: { schema: () => changeIdentitySchema, get: (revision) => ({ id: revision.changeId }) },
  },
});

/** A decision loaded with its actor and, when it applied its microchange, the revision it produced. */
export type LoadedDecision = ChangeDecision & { revision: EntityRevision | null };

export const changeDecisionSchema = defineResource<LoadedDecision>({
  type: 'change-decisions',
  id: (decision) => decision.id,
  attributes: {
    action: (decision) => decision.action,
    previousStatus: (decision) => decision.previousStatus,
    resultingStatus: (decision) => decision.resultingStatus,
    reason: (decision) => decision.reason,
    observedVersion: (decision) => decision.observedVersion,
    observedValue: (decision) => decision.observedValue,
    decidedAt: (decision) => decision.decidedAt.toISOString(),
  },
  relationships: {
    change: { schema: () => changeIdentitySchema, get: (decision) => ({ id: decision.changeId }) },
    actor: { schema: () => publicAccountSchema, get: (decision) => decision.actor ?? null },
    revision: { schema: () => entityRevisionSchema, get: (decision) => decision.revision },
  },
});

class DecisionAttributes {
  @ApiProperty({ enum: DECISION_ACTIONS })
  action: string;

  @ApiProperty({ enum: CHANGE_STATUSES })
  previousStatus: string;

  @ApiProperty({ enum: CHANGE_STATUSES })
  resultingStatus: string;

  @ApiProperty({ type: String, nullable: true, description: 'Obligatorio al rechazar' })
  reason: string | null;

  @ApiProperty({ description: 'Versión de la raíz al decidir' })
  observedVersion: number;

  @ApiProperty({ type: Object, description: 'Valor que tenía el objetivo al decidir', example: { exists: false } })
  observedValue: object;

  @ApiProperty({ format: 'date-time' })
  decidedAt: string;
}

class Linkage {
  @ApiProperty({ type: ResourceIdentifier })
  data: ResourceIdentifier;
}

class NullableLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

class DecisionRelationships {
  @ApiProperty({ type: Linkage })
  change: Linkage;

  @ApiProperty({ type: NullableLinkage, description: 'Cuenta que decidió; null en una decisión automática' })
  actor: NullableLinkage;

  @ApiProperty({ type: NullableLinkage, description: 'Revisión que produjo una aplicación; null en las demás decisiones' })
  revision: NullableLinkage;
}

export class ChangeDecisionResource {
  @ApiProperty({ enum: ['change-decisions'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: DecisionAttributes })
  attributes: DecisionAttributes;

  @ApiProperty({ type: DecisionRelationships })
  relationships: DecisionRelationships;
}
