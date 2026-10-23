import { INestApplicationContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { User } from '../accounts/entities/user.entity';
import { ImageUploadsService } from '../images/image-uploads.service';

/** Side of the square profile placeholders, in pixels. */
const SIDE = 400;

/** A standing figure is about three times taller than wide. */
const FULL_BODY = { width: 300, height: 900 };

/**
 * Placeholder images of the seed, uploaded for the catalog through the same
 * upload flow as the editor's (ADR 0005). The seed's moderation team uploads
 * them, as staff have no catalog upload quota.
 */
export class SeedImages {
  private readonly uploads: ImageUploadsService;

  constructor(
    app: INestApplicationContext,
    private readonly uploader: User,
  ) {
    this.uploads = app.get(ImageUploadsService);
  }

  /** Uploads a square of solid colour, always the same for the same entry, and returns its public URL. */
  placeholder(key: string): Promise<string> {
    return this.upload(key, { width: SIDE, height: SIDE });
  }

  /** Uploads a portrait of solid colour for a person's full-body photo, and returns its public URL. */
  fullBodyPlaceholder(key: string): Promise<string> {
    return this.upload(`${key}/full-body`, FULL_BODY);
  }

  private async upload(seed: string, { width, height }: { width: number; height: number }): Promise<string> {
    const [r, g, b] = createHash('sha256').update(seed).digest();
    const png = await sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
    return (await this.uploads.upload(this.uploader, 'catalog', png)).url;
  }
}
