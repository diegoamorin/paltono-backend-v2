import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery } from '../common/json-api/query';
import { accountNotFound } from './administration';
import { UserStatusChange } from './entities/user-status-change.entity';
import { User, UserStatus } from './entities/user.entity';
import { changeStatus } from './status-changes';

/** Account status administration over HTTP; every change needs an operational administrator. */
@Injectable()
export class StatusChangesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  change(actor: User, userUuid: string, newStatus: UserStatus, reason: string): Promise<UserStatusChange> {
    return this.dataSource.transaction((manager) =>
      changeStatus(manager, { actorId: actor.id, userUuid, newStatus, reason, now: this.clock.now() }),
    );
  }

  /** One page of the status changes of an account, with the accounts they link to. */
  async list(userUuid: string, query: CollectionQuery): Promise<{ changes: UserStatusChange[]; total: number }> {
    const user = await this.dataSource.getRepository(User).findOneBy({ uuid: userUuid });
    if (!user) throw accountNotFound();
    const [changes, total] = await this.dataSource.getRepository(UserStatusChange).findAndCount({
      where: { userId: user.id },
      relations: { user: true, changedBy: true },
      order: Object.fromEntries(query.sort.map(({ field, direction }) => [field, direction])),
      ...pageWindow(query),
    });
    return { changes, total };
  }
}
