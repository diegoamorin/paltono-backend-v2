import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { entityNotFound, lockContributor } from './editorial-access';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';

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
}
