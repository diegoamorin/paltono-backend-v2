import { INestApplicationContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { User } from '../accounts/entities/user.entity';
import { ImageUploadsService } from '../images/image-uploads.service';

/** Side of the square placeholders, in pixels. */
const SIDE = 400;

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

  /** Uploads a solid colour, always the same for the same entry, and returns its public URL. */
  async placeholder(key: string): Promise<string> {
    const [r, g, b] = createHash('sha256').update(key).digest();
    const png = await sharp({ create: { width: SIDE, height: SIDE, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
    return (await this.uploads.upload(this.uploader, 'catalog', png)).url;
  }
}
