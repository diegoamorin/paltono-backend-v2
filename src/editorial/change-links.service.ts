import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget, In, ObjectLiteral } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { JsonApiErrorInput } from '../common/json-api/json-api.exception';
import { dependencyCycle, hasDependencyCycle } from './dependency-graph';
import { changeNotFound, invalid } from './editorial-access';
import { lockOwnDraft, touchDraft } from './drafts';
import { ProposalChange } from './entities/proposal-change.entity';
import { ChangeDependency, ChangeSource } from './entities/proposal-links.entity';
import { ProposalSource } from './entities/proposal-source.entity';

/** The links of a draft microchange to other rows of its proposal: the microchanges it depends on and the sources that back it. */
@Injectable()
export class ChangeLinksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /** Adds dependencies; those already declared stay. Returns all of them. */
  addDependencies(user: User, changeId: string, dependsOn: string[]): Promise<string[]> {
    return this.inDraft(user, changeId, async (manager, change) => {
      const errors: JsonApiErrorInput[] = [];
      for (const [index, dependsOnChangeId] of dependsOn.entries()) {
        const source = { pointer: `/data/${index}/id` };
        if (dependsOnChangeId === changeId) {
          errors.push({ code: 'self_dependency', detail: 'A microchange cannot depend on itself', source });
        } else if (!(await manager.existsBy(ProposalChange, { id: dependsOnChangeId, proposalId: change.proposalId }))) {
          errors.push({ code: 'invalid_dependency', detail: 'A microchange depends only on microchanges of its own proposal', source });
        }
      }
      if (errors.length > 0) throw invalid(errors);
      for (const dependsOnChangeId of dependsOn) {
        await insertIgnoring(manager, ChangeDependency, { changeId, dependsOnChangeId, proposalId: change.proposalId });
      }
      if (await hasDependencyCycle(manager, change.proposalId)) throw invalid([dependencyCycle()]);
      return dependenciesOf(manager, changeId);
    });
  }

  /** Removes dependencies; those not declared are ignored. Returns the remaining ones. */
  removeDependencies(user: User, changeId: string, dependsOn: string[]): Promise<string[]> {
    return this.inDraft(user, changeId, async (manager) => {
      if (dependsOn.length > 0) await manager.delete(ChangeDependency, { changeId, dependsOnChangeId: In(dependsOn) });
      return dependenciesOf(manager, changeId);
    });
  }

  /** Links sources; those already linked stay. Returns all of them. */
  addSources(user: User, changeId: string, sourceIds: string[]): Promise<string[]> {
    return this.inDraft(user, changeId, async (manager, change) => {
      const errors: JsonApiErrorInput[] = [];
      for (const [index, id] of sourceIds.entries()) {
        if (!(await manager.existsBy(ProposalSource, { id, proposalId: change.proposalId }))) {
          errors.push({ code: 'invalid_source', detail: 'A microchange links only sources of its own proposal', source: { pointer: `/data/${index}/id` } });
        }
      }
      if (errors.length > 0) throw invalid(errors);
      for (const sourceId of sourceIds) await insertIgnoring(manager, ChangeSource, { changeId, sourceId, proposalId: change.proposalId });
      return sourcesOf(manager, changeId);
    });
  }

  /** Unlinks sources; those not linked are ignored. Returns the remaining ones. */
  removeSources(user: User, changeId: string, sourceIds: string[]): Promise<string[]> {
    return this.inDraft(user, changeId, async (manager) => {
      if (sourceIds.length > 0) await manager.delete(ChangeSource, { changeId, sourceId: In(sourceIds) });
      return sourcesOf(manager, changeId);
    });
  }

  /** Runs a write to the links of a microchange of the user's own draft, which locks the draft first. */
  private inDraft(user: User, changeId: string, write: (manager: EntityManager, change: ProposalChange) => Promise<string[]>): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const change = await manager.findOneBy(ProposalChange, { id: changeId });
      if (!change) throw changeNotFound();
      const proposal = await lockOwnDraft(manager, user, change.proposalId, changeNotFound);
      const links = await write(manager, change);
      await touchDraft(manager, proposal, this.clock.now());
      return links;
    });
  }
}

async function insertIgnoring<T extends ObjectLiteral>(manager: EntityManager, target: EntityTarget<T>, values: QueryDeepPartialEntity<T>): Promise<void> {
  await manager.createQueryBuilder().insert().into(target).values(values).orIgnore().execute();
}

async function dependenciesOf(manager: EntityManager, changeId: string): Promise<string[]> {
  const dependencies = await manager.find(ChangeDependency, { where: { changeId }, order: { dependsOnChangeId: 'ASC' } });
  return dependencies.map(({ dependsOnChangeId }) => dependsOnChangeId);
}

async function sourcesOf(manager: EntityManager, changeId: string): Promise<string[]> {
  const sources = await manager.find(ChangeSource, { where: { changeId }, order: { sourceId: 'ASC' } });
  return sources.map(({ sourceId }) => sourceId);
}

/** Microchanges with the ids of the microchanges they depend on and of their linked sources. */
export async function withLinks(manager: EntityManager, changes: ProposalChange[]): Promise<ProposalChange[]> {
  const ids = changes.map(({ id }) => id);
  const dependencies = ids.length > 0 ? await manager.find(ChangeDependency, { where: { changeId: In(ids) }, order: { dependsOnChangeId: 'ASC' } }) : [];
  const sources = ids.length > 0 ? await manager.find(ChangeSource, { where: { changeId: In(ids) }, order: { sourceId: 'ASC' } }) : [];
  for (const change of changes) {
    change.dependsOnIds = dependencies.filter(({ changeId }) => changeId === change.id).map(({ dependsOnChangeId }) => dependsOnChangeId);
    change.sourceIds = sources.filter(({ changeId }) => changeId === change.id).map(({ sourceId }) => sourceId);
  }
  return changes;
}
