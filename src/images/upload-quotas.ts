import { HttpStatus } from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { User } from '../accounts/entities/user.entity';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { ImageUpload, ImageUploadPurpose } from './entities/image-upload.entity';

/** The upload quota counts the uploads of the last 15 days, by the application clock. */
export const UPLOAD_QUOTA_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * Uploads an account may make per window: 4 of catalog for users, none counted
 * for staff, and 1 avatar for everyone. `null` means no limit.
 */
export function uploadQuota(purpose: ImageUploadPurpose, account: User): number | null {
  if (purpose === 'avatar') return 1;
  return account.role === 'user' ? 4 : null;
}

/**
 * Refuses an upload over the account's quota, with the moment it frees up: when
 * the oldest upload that keeps the quota full leaves the window. Call it inside
 * the upload's transaction, with the account row locked.
 */
export async function requireUploadQuota(
  manager: EntityManager,
  account: User,
  purpose: ImageUploadPurpose,
  now: Date,
): Promise<void> {
  const quota = uploadQuota(purpose, account);
  if (quota === null) return;

  const recent = await manager.find(ImageUpload, {
    select: { id: true, createdAt: true },
    where: { uploadedById: account.id, purpose, createdAt: MoreThan(new Date(now.getTime() - UPLOAD_QUOTA_WINDOW_MS)) },
    order: { createdAt: 'DESC' },
    take: quota,
  });
  if (recent.length < quota) return;

  const availableAt = new Date(recent[quota - 1].createdAt.getTime() + UPLOAD_QUOTA_WINDOW_MS).toISOString();
  throw new JsonApiException(HttpStatus.TOO_MANY_REQUESTS, [
    {
      code: 'upload_quota_exceeded',
      detail: `The ${purpose} upload quota of ${quota} every 15 days is used up until ${availableAt}`,
      meta: { availableAt },
    },
  ]);
}
