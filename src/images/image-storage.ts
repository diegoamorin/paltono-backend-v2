import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { ImageUpload } from './entities/image-upload.entity';

/**
 * Where uploaded images live, by storage key (`<random id>.<extension>`). The
 * public URL of a key is the configured base plus the key; the storage itself
 * knows nothing of URLs.
 */
export abstract class ImageStorage {
  /** Stores `bytes` under `key`, served with `contentType`; replaces any file with the same key. */
  abstract put(key: string, bytes: Buffer, contentType: string): Promise<void>;

  /** Removes the file under `key`; a missing file is not an error. */
  abstract delete(key: string): Promise<void>;
}

/**
 * Removes the stored files of uploads by their public URL, such as an avatar
 * that is replaced, cleared or belongs to a deleted account.
 */
@Injectable()
export class UploadedImageFiles {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ImageStorage,
    private readonly clock: Clock,
  ) {}

  /**
   * Removes the file of the upload recorded with `url`; the record stays, as the
   * history of the account, with the moment its file was removed. A URL no
   * upload has, or `null`, removes nothing.
   */
  async remove(url: string | null): Promise<void> {
    if (url === null) return;
    const uploads = this.dataSource.getRepository(ImageUpload);
    const upload = await uploads.findOne({ select: { id: true, url: true }, where: { url } });
    if (!upload) return;
    // The URL is the base at upload time plus the key, so its last segment is the key whatever the base is now.
    await this.storage.delete(upload.url.slice(upload.url.lastIndexOf('/') + 1));
    // Recorded once removed, so a failure to remove leaves the upload looking stored, never the reverse.
    await uploads.update({ id: upload.id, fileRemovedAt: IsNull() }, { fileRemovedAt: this.clock.now() });
  }
}

/**
 * Headers every stored image is served with, so an SVG opened on its own can
 * run, load or embed nothing (ADR 0005). Production sets them with a Cloudflare
 * transform rule on the public domain, as R2 cannot set them per object; the
 * local storage sets them itself.
 */
export const IMAGE_RESPONSE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

/** URL prefix under which the backend serves a local storage folder. */
export const LOCAL_IMAGES_PATH = '/images';

/**
 * A folder on disk, served by the backend itself under `/images`: the storage of
 * development and tests. The content type follows from the key's extension.
 */
export class LocalImageStorage extends ImageStorage {
  constructor(readonly directory: string) {
    super();
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(key), bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    if (!/^[\w-]+\.\w+$/.test(key)) throw new Error(`Invalid image storage key "${key}"`);
    return join(this.directory, key);
  }
}
