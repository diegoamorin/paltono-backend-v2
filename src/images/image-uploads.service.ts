import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ImageUpload, ImageUploadPurpose } from './entities/image-upload.entity';
import { processImage } from './image-processing';
import { ImageStorage } from './image-storage';
import { requireUploadQuota } from './upload-quotas';

/**
 * Image uploads (ADR 0005): validates and cleans a file, checks the account's
 * upload quota, stores it and records it. A rejection stores and records
 * nothing, so it consumes no quota.
 */
@Injectable()
export class ImageUploadsService {
  private readonly publicBaseUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ImageStorage,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.publicBaseUrl = config.images.publicBaseUrl;
  }

  /**
   * Uploads `file` for `purpose` as `user`, and returns the recorded upload with
   * its uploader. `use`, when given, runs in the upload's transaction with the
   * uploader locked and the new URL, so a change that uses the image (such as
   * the avatar) commits or fails with the upload.
   */
  async upload(
    user: User,
    purpose: ImageUploadPurpose,
    file: Buffer,
    use?: (manager: EntityManager, uploader: User, url: string) => Promise<void>,
  ): Promise<ImageUpload> {
    const image = await processImage(file);
    const id = randomUUID();
    const key = `${id}.${image.extension}`;

    return this.dataSource.transaction(async (manager) => {
      // The lock serializes an account's uploads, so concurrent ones cannot overrun the quota.
      const uploader = await manager.findOne(User, { where: { id: user.id }, lock: { mode: 'pessimistic_write' } });
      if (!uploader || uploader.status !== 'active') {
        throw new JsonApiException(HttpStatus.UNAUTHORIZED, [{ code: 'unauthenticated', detail: 'The account can no longer act' }]);
      }
      const now = this.clock.now();
      await requireUploadQuota(manager, uploader, purpose, now);

      const url = this.publicBaseUrl + key;
      await manager.insert(ImageUpload, {
        id,
        uploadedById: uploader.id,
        purpose,
        url,
        bytes: image.bytes.length,
        width: image.width,
        height: image.height,
        createdAt: now,
      });
      await use?.(manager, uploader, url);
      // Stored last, so a failure before or while storing rolls the record back and
      // stores nothing. A failure to commit after storing leaves the file orphaned.
      await this.storage.put(key, image.bytes, image.contentType);
      return manager.findOneOrFail(ImageUpload, { where: { id }, relations: { uploadedBy: true } });
    });
  }
}
