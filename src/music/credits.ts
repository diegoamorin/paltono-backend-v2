import { EntityManager } from 'typeorm';
import { CatalogIdentity } from '../catalog-identities/entities/catalog-identity.entity';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { ContributionRoleScope } from '../vocabularies/entities/contribution-role.entity';
import { Recording, RecordingContribution } from './entities/recording.entity';
import { Release } from './entities/release.entity';
import { ReleaseContribution } from './entities/track.entity';
import { Credit, Work, WorkContribution } from './entities/work.entity';

/*
 * The reads and writes of the credits of a work, a recording or a release, which this
 * module owns. The editorial flow calls them inside the transaction that
 * applies a relation change. Every read is scoped to one owner, so a key never
 * reaches the credit of another one.
 */

export type CreditScope = 'work' | 'recording' | 'release';

/** A credit as relation changes propose it and revisions record it; the identity by its editorial root. */
export interface CreditValue {
  identity: { entity_id: string };
  roleId: number;
  position: number;
  creditedAs?: string | null;
  details?: string | null;
  sourceText?: string | null;
  sourceUrl?: string | null;
}

/** The id of the work, recording or release that owns credits; a work's is a BIGINT as a string. */
export type OwnerId = string | number;

const TABLES = {
  work: { entity: WorkContribution, owner: 'workId', root: Work },
  recording: { entity: RecordingContribution, owner: 'recordingId', root: Recording },
  release: { entity: ReleaseContribution, owner: 'releaseId', root: Release },
} as const;

/** Whether a role may be credited in a scope; the composite foreign key enforces it too. */
export function roleAllowsScope(manager: EntityManager, contributionRoleId: number, scope: CreditScope): Promise<boolean> {
  return manager.existsBy(ContributionRoleScope, { contributionRoleId, scope });
}

export async function findCredit(manager: EntityManager, scope: CreditScope, ownerId: OwnerId, id: number): Promise<CreditValue | null> {
  const { entity, owner } = TABLES[scope];
  const credit = await manager.findOneBy<Credit>(entity, { id, [owner]: ownerId });
  return credit && creditValue(manager, credit);
}

export async function insertCredit(manager: EntityManager, scope: CreditScope, ownerId: OwnerId, value: CreditValue, now: Date): Promise<number> {
  const { entity, owner } = TABLES[scope];
  const { identifiers } = await manager.insert(entity, { ...(await columns(manager, value)), [owner]: ownerId, roleScope: scope, createdAt: now, updatedAt: now });
  await touchOwner(manager, scope, ownerId, now);
  return identifiers[0].id as number;
}

export async function updateCredit(manager: EntityManager, scope: CreditScope, ownerId: OwnerId, id: number, value: CreditValue, now: Date): Promise<void> {
  const { entity, owner } = TABLES[scope];
  await manager.update(entity, { id, [owner]: ownerId }, { ...(await columns(manager, value)), updatedAt: now });
  await touchOwner(manager, scope, ownerId, now);
}

export async function deleteCredit(manager: EntityManager, scope: CreditScope, ownerId: OwnerId, id: number, now: Date): Promise<void> {
  const { entity, owner } = TABLES[scope];
  await manager.delete(entity, { id, [owner]: ownerId });
  await touchOwner(manager, scope, ownerId, now);
}

/** The value of a credit, naming its identity by editorial root as its proposals do. */
async function creditValue(manager: EntityManager, credit: Credit): Promise<CreditValue> {
  const identity = await manager.findOneOrFail(CatalogIdentity, { select: { editorialEntityId: true }, where: { id: credit.catalogIdentityId } });
  return {
    identity: { entity_id: identity.editorialEntityId },
    roleId: credit.contributionRoleId,
    position: credit.position,
    creditedAs: credit.creditedAs,
    details: credit.details,
    sourceText: credit.sourceText,
    sourceUrl: credit.sourceUrl,
  };
}

/** The columns of a proposed credit; its identity is published by the time it applies. */
async function columns(manager: EntityManager, value: CreditValue) {
  return {
    catalogIdentityId: (await identityIdOf(manager, value.identity.entity_id.toLowerCase()))!,
    contributionRoleId: value.roleId,
    position: value.position,
    creditedAs: value.creditedAs ?? null,
    details: value.details ?? null,
    sourceText: value.sourceText ?? null,
    sourceUrl: value.sourceUrl ?? null,
  };
}

async function touchOwner(manager: EntityManager, scope: CreditScope, ownerId: OwnerId, now: Date): Promise<void> {
  await manager.update(TABLES[scope].root, { id: ownerId as never }, { updatedAt: now });
}
