import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { UploadedImageFiles } from '../images/image-storage';
import { USERNAME_CHANGE_INTERVAL_MS } from './account-rules';
import { accountNotFound } from './administration';
import { User } from './entities/user.entity';
import { takenError } from './taken-errors';

export interface ProfileChanges {
  username?: string;
  displayName?: string;
  /** Only `null`, which clears the avatar; an avatar is set by uploading it. */
  avatarUrl?: null;
  bio?: string | null;
}

/** Public profiles of accounts and the edits of an account to its own. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly imageFiles: UploadedImageFiles,
  ) {}

  async show(userUuid: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOneBy({ uuid: userUuid });
    if (!user) throw accountNotFound();
    return user;
  }

  /** The account with a username, deleted ones included since their username stays reserved. */
  findByUsername(username: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOneBy({ username: username.toLowerCase() });
  }

  /**
   * Applies the given changes to the account, whose id the request must name, and
   * returns it updated. Clearing the avatar also removes its file. A new username needs 7 full days since the last one was
   * assigned; the interval is checked with the account locked, so simultaneous
   * changes cannot both pass, and sending the current username changes nothing.
   */
  async update(user: User, id: string, changes: ProfileChanges): Promise<User> {
    if (id !== user.uuid) {
      throw new JsonApiException(HttpStatus.CONFLICT, [
        { code: 'id_mismatch', detail: 'The id must be the id of the own account', source: { pointer: '/data/id' } },
      ]);
    }
    let clearedAvatar: string | null = null;
    let account: User;
    try {
      account = await this.dataSource.transaction(async (manager) => {
        const now = this.clock.now();
        const current = await manager.findOneOrFail(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
        if (changes.avatarUrl === null) clearedAvatar = current.avatarUrl;
        const updated = { ...current, ...withoutUndefined(changes), updatedAt: now };
        if (updated.bio === '') updated.bio = null;
        if (updated.username !== current.username) {
          if (now.getTime() < current.usernameChangedAt.getTime() + USERNAME_CHANGE_INTERVAL_MS) {
            throw new JsonApiException(HttpStatus.CONFLICT, [
              {
                code: 'username_change_too_soon',
                detail: 'The username can change once 7 full days have passed since the last change',
                source: { pointer: '/data/attributes/username' },
              },
            ]);
          }
          updated.usernameChangedAt = now;
        }
        return manager.save(User, updated);
      });
    } catch (error) {
      throw takenError(error) ?? error;
    }
    // Removed once the change is committed, so a failed edit keeps the avatar's file.
    await this.imageFiles.remove(clearedAvatar);
    return account;
  }
}

function withoutUndefined<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<T>;
}
