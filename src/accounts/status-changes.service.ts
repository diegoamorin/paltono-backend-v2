import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { pageWindow } from '../common/json-api/document';
import { CollectionQuery } from '../common/json-api/query';
import { UploadedImageFiles } from '../images/image-storage';
import { accountNotFound } from './administration';
import { UserStatusChange } from './entities/user-status-change.entity';
import { User, UserStatus } from './entities/user.entity';
import { changeStatus, deleteOwnAccount } from './status-changes';

/**
 * Account status changes over HTTP: those of an operational administrator and
 * the voluntary deletion of an account by itself. A deletion also removes the
 * avatar's file, once committed; the account's catalog uploads stay.
 */
@Injectable()
export class StatusChangesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly imageFiles: UploadedImageFiles,
  ) {}

  async change(actor: User, userUuid: string, newStatus: UserStatus, reason: string): Promise<UserStatusChange> {
    const change = await this.dataSource.transaction((manager) =>
      changeStatus(manager, { actorId: actor.id, userUuid, newStatus, reason, now: this.clock.now() }),
    );
    // The change links the account as it was before, so with the avatar its deletion cleared.
    if (change.newStatus === 'deleted') await this.imageFiles.remove(change.user?.avatarUrl ?? null);
    return change;
  }

  async deleteOwn(user: User, password: string): Promise<void> {
    const avatarUrl = await this.dataSource.transaction((manager) =>
      deleteOwnAccount(manager, user.id, password, this.clock.now()),
    );
    await this.imageFiles.remove(avatarUrl);
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
