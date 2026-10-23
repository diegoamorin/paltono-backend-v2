import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { UploadedImageFiles } from './image-storage';
import { ImageUploadsService } from './image-uploads.service';

/** Avatars: uploaded and applied to the account at once, with no editorial review (ADR 0005). */
@Injectable()
export class AvatarsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly uploads: ImageUploadsService,
    private readonly files: UploadedImageFiles,
    private readonly clock: Clock,
  ) {}

  /**
   * Uploads `file` as the avatar of `user` and returns the account with it. The
   * replaced avatar's file is removed once the new one is committed.
   */
  async replace(user: User, file: Buffer): Promise<User> {
    let replaced: string | null = null;
    await this.uploads.upload(user, 'avatar', file, async (manager, uploader, url) => {
      replaced = uploader.avatarUrl;
      await manager.update(User, { id: uploader.id }, { avatarUrl: url, updatedAt: this.clock.now() });
    });
    await this.files.remove(replaced);
    return this.dataSource.getRepository(User).findOneByOrFail({ id: user.id });
  }
}
