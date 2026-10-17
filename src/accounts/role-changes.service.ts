import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery } from '../common/json-api/query';
import { UserRoleChange } from './entities/user-role-change.entity';
import { User, UserRole } from './entities/user.entity';
import { accountNotFound, changeRole } from './role-changes';

/** Role administration over HTTP; every change needs an operational administrator. */
@Injectable()
export class RoleChangesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  change(actor: User, userUuid: string, newRole: UserRole, reason: string): Promise<UserRoleChange> {
    return this.dataSource.transaction((manager) =>
      changeRole(manager, { actorId: actor.id, userUuid, newRole, reason, now: this.clock.now() }),
    );
  }

  /** One page of the role changes of an account, with the accounts they link to. */
  async list(userUuid: string, query: CollectionQuery): Promise<{ changes: UserRoleChange[]; total: number }> {
    const user = await this.dataSource.getRepository(User).findOneBy({ uuid: userUuid });
    if (!user) throw accountNotFound();
    const [changes, total] = await this.dataSource.getRepository(UserRoleChange).findAndCount({
      where: { userId: user.id },
      relations: { user: true, changedBy: true },
      order: Object.fromEntries(query.sort.map(({ field, direction }) => [field, direction])),
      ...pageWindow(query),
    });
    return { changes, total };
  }
}
