import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ImageStorage } from './image-storage';

export interface R2Settings {
  /** The account's S3 API endpoint, `https://<account id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * A Cloudflare R2 bucket, the storage of production (ADR 0005). R2 speaks the
 * S3 API; the bucket is served publicly from `IMAGE_PUBLIC_BASE_URL`, so the
 * backend only writes and removes objects. Verified by hand against the real
 * bucket, not by the automated tests.
 */
export class R2ImageStorage extends ImageStorage {
  private readonly client: S3Client;

  constructor(private readonly settings: R2Settings) {
    super();
    this.client = new S3Client({
      region: 'auto',
      endpoint: settings.endpoint,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Keys are random and never reused for other content, so the object can be cached forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  /** Deleting a missing object succeeds in S3 and R2, as the port requires. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }
}
