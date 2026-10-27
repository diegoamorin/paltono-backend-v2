import { Inject, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ImageUpload } from './entities/image-upload.entity';

/**
 * The icon URL rule of platforms (ADR 0005): an icon is the URL of an SVG
 * uploaded with POST /v1/images/platform-icons, under the configured public
 * base, whose file is still stored. That no other platform has it is up to
 * the platforms' unique constraint.
 */
@Injectable()
export class PlatformIconUrls {
  private readonly publicBaseUrl: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.publicBaseUrl = config.images.publicBaseUrl;
  }

  async isUsable(manager: EntityManager, url: string): Promise<boolean> {
    return url.startsWith(this.publicBaseUrl) && manager.existsBy(ImageUpload, { url, purpose: 'platform_icon', fileRemovedAt: IsNull() });
  }

  describe(url: string): string {
    return `${url} is not an icon uploaded under ${this.publicBaseUrl} (POST /v1/images/platform-icons)`;
  }
}
