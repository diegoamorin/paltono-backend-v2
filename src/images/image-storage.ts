import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
