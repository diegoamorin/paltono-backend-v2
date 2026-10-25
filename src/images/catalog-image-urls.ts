import { Inject, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ImageUpload } from './entities/image-upload.entity';

/** An image URL a value proposes, at a JSON Pointer path inside the proposed envelope. */
export interface ImageUrlReference {
  url: string;
  path: string;
}

/** An image URL the rule refuses, at the path of its reference. */
export interface ImageUrlProblem {
  code: 'unknown_catalog_image';
  detail: string;
  path: string;
}

/**
 * JSON Schema of a catalog image field in a payload. The format is checked
 * here and by the database; whether the URL is a catalog upload, by
 * `CatalogImageUrls`.
 */
export const CATALOG_IMAGE_URL = {
  type: ['string', 'null'],
  maxLength: 2048,
  pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$',
  description: 'URL de una imagen subida para el catálogo con POST /v1/images, o null',
};

/** The reference at `path` when `url` is an image URL; null proposes no image and needs none. */
export function imageUrlAt(url: unknown, path: string): ImageUrlReference[] {
  return typeof url === 'string' ? [{ url, path }] : [];
}

/**
 * The image URL rule of the catalog (ADR 0005): an image field holds null or
 * the URL of an image uploaded for the catalog, under the configured public
 * base, whose file is still stored. It is checked when a microchange is
 * written and submitted, never when it is applied, so changing the base
 * leaves what was applied valid.
 */
@Injectable()
export class CatalogImageUrls {
  private readonly publicBaseUrl: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.publicBaseUrl = config.images.publicBaseUrl;
  }

  /** The references among `references` that are not catalog uploads under the current base. */
  async problems(manager: EntityManager, references: ImageUrlReference[]): Promise<ImageUrlProblem[]> {
    const problems: ImageUrlProblem[] = [];
    for (const { url, path } of references) {
      const uploaded =
        url.startsWith(this.publicBaseUrl) && (await manager.existsBy(ImageUpload, { url, purpose: 'catalog', fileRemovedAt: IsNull() }));
      if (!uploaded) {
        problems.push({
          code: 'unknown_catalog_image',
          detail: `${url} is not an image uploaded for the catalog under ${this.publicBaseUrl} (POST /v1/images)`,
          path,
        });
      }
    }
    return problems;
  }
}
