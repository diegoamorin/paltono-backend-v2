import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery } from '../common/json-api/query';
import { entityNotFound, isStaff, lockContributor } from './editorial-access';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { EntityRevision } from './entities/entity-revision.entity';

/** Editorial roots: reservations for new entries and their editorial state. */
@Injectable()
export class EditorialEntitiesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /** Reserves a root for a creation: `reserved`, version 0 and no domain row. */
  reserve(user: User, entityType: EditorialEntityType): Promise<EditorialEntity> {
    return this.dataSource.transaction(async (manager) => {
      const author = await lockContributor(manager, user.id);
      const id = randomUUID();
      await manager.insert(EditorialEntity, {
        id,
        entityType,
        publicationStatus: 'reserved',
        createdById: author.id,
        currentVersion: 0,
        creationChangeId: null,
        createdAt: this.clock.now(),
        publishedAt: null,
        withdrawnAt: null,
      });
      return manager.findOneOrFail(EditorialEntity, { where: { id }, relations: { createdBy: true } });
    });
  }

  /** A root as the viewer may see it: a reservation only exists for its creator. */
  async show(viewer: User | undefined, id: string): Promise<EditorialEntity> {
    const entity = await this.dataSource.getRepository(EditorialEntity).findOne({ where: { id }, relations: { createdBy: true } });
    if (!entity || (entity.publicationStatus === 'reserved' && entity.createdById !== viewer?.id)) throw entityNotFound();
    return entity;
  }

  /**
   * The applied revisions of a root. A revision reveals the outcome of its
   * microchange, so staff read them all and anyone else only those of their
   * own microchanges.
   */
  async revisions(viewer: User, id: string, query: CollectionQuery): Promise<{ revisions: EntityRevision[]; total: number }> {
    await this.show(viewer, id);
    const revisions = this.dataSource.manager.createQueryBuilder(EntityRevision, 'revision').where('revision.entity_id = :id', { id });
    if (!isStaff(viewer)) {
      revisions
        .innerJoin('proposal_changes', 'change', 'change.id = revision.change_id')
        .innerJoin('change_proposals', 'proposal', 'proposal.id = change.proposal_id')
        .andWhere('proposal.author_id = :authorId', { authorId: viewer.id });
    }
    const { skip, take } = pageWindow(query);
    revisions.orderBy('revision.version', 'ASC');
    const [page, total] = await revisions.offset(skip).limit(take).getManyAndCount();
    return { revisions: page, total };
  }
}
