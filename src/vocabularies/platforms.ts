import { HttpStatus, Injectable, applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { collectionQuery, requireOneOf } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
import { UploadedImageFiles } from '../images/image-storage';
import { PlatformIconUrls } from '../images/platform-icon-urls';
import { Platform } from './entities/platform.entity';
import {
  IfPresent,
  NAME_MAX_LENGTH,
  NameValidation,
  SLUG_MAX_LENGTH,
  SlugValidation,
  requestDocument,
  responseResource,
} from './vocabulary-documents';
import { AfterCommit, Vocabulary, VocabularyStore, containsFilter, equalsFilter } from './vocabulary-store';
import { vocabularyController } from './vocabulary.controller';

/** `filter[supports]` values and the flag each one checks. */
const SUPPORTS: Record<string, keyof Platform> = {
  catalog_identity: 'supportsCatalogIdentity',
  track: 'supportsTrack',
  album: 'supportsAlbum',
};

const schema = defineResource<Platform>({
  type: 'platforms',
  id: (platform) => String(platform.id),
  attributes: {
    name: (platform) => platform.name,
    slug: (platform) => platform.slug,
    iconUrl: (platform) => platform.iconUrl,
    supportsCatalogIdentity: (platform) => platform.supportsCatalogIdentity,
    supportsTrack: (platform) => platform.supportsTrack,
    supportsAlbum: (platform) => platform.supportsAlbum,
    createdAt: (platform) => platform.createdAt.toISOString(),
    updatedAt: (platform) => platform.updatedAt.toISOString(),
  },
});

export const PLATFORMS: Vocabulary<Platform> = {
  type: 'platforms',
  entity: Platform,
  schema,
  query: collectionQuery(schema, { sort: ['name'], defaultSort: 'name', filters: ['q', 'slug', 'supports'] }),
  filters: {
    q: containsFilter('name'),
    slug: equalsFilter('slug'),
    supports: (builder, value) => {
      requireOneOf('filter[supports]', value, Object.keys(SUPPORTS));
      builder.andWhere(`entry.${SUPPORTS[value]} = true`);
    },
  },
  uniqueAttributes: { platforms_name_key: 'name', platforms_slug_key: 'slug', platforms_icon_url_key: 'iconUrl' },
  timestamps: true,
};

// The format only: whether the URL is an uploaded icon is up to `PlatformIconUrls` (ADR 0005).
const IconUrlValidation = () =>
  // No TLD required: the public base is `http://localhost/...` in development and tests.
  applyDecorators(IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }), MaxLength(2048));

const ICON_URL_DESCRIPTION =
  'URL de un SVG subido con POST /v1/images/platform-icons que ninguna otra plataforma externa use. ' +
  'Al reemplazarlo o borrar la plataforma externa, se borra el archivo del icono anterior.';

class PlatformAttributes {
  @ApiProperty({ example: 'Spotify', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;

  @ApiProperty({ example: 'spotify', maxLength: SLUG_MAX_LENGTH })
  @SlugValidation()
  slug: string;

  @ApiProperty({ example: 'https://img.paltono.com/0b6f1c9e-4d3a-4f7e-9a51-2c8d7e6b5a40.svg', description: ICON_URL_DESCRIPTION })
  @IconUrlValidation()
  iconUrl: string;

  @ApiPropertyOptional({ default: false, description: 'Admite enlaces de identidades, incluidos perfiles artísticos' })
  @IsOptional()
  @IsBoolean()
  supportsCatalogIdentity?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  supportsTrack?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  supportsAlbum?: boolean;
}

class PlatformChanges {
  @ApiPropertyOptional({ maxLength: NAME_MAX_LENGTH })
  @IfPresent()
  @NameValidation()
  name?: string;

  @ApiPropertyOptional({ maxLength: SLUG_MAX_LENGTH })
  @IfPresent()
  @SlugValidation()
  slug?: string;

  @ApiPropertyOptional({ description: ICON_URL_DESCRIPTION })
  @IfPresent()
  @IconUrlValidation()
  iconUrl?: string;

  @ApiPropertyOptional()
  @IfPresent()
  @IsBoolean()
  supportsCatalogIdentity?: boolean;

  @ApiPropertyOptional()
  @IfPresent()
  @IsBoolean()
  supportsTrack?: boolean;

  @ApiPropertyOptional()
  @IfPresent()
  @IsBoolean()
  supportsAlbum?: boolean;
}

class PlatformResponseAttributes {
  @ApiProperty({ example: 'Spotify' })
  name: string;

  @ApiProperty({ example: 'spotify' })
  slug: string;

  @ApiProperty()
  iconUrl: string;

  @ApiProperty()
  supportsCatalogIdentity: boolean;

  @ApiProperty()
  supportsTrack: boolean;

  @ApiProperty()
  supportsAlbum: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

/**
 * Platforms keep the icon rule: each icon is an uploaded SVG of its own, and
 * the file of an icon the platform no longer has is removed once that commits.
 */
@Injectable()
export class PlatformsStore extends VocabularyStore<Platform> {
  constructor(
    dataSource: DataSource,
    clock: Clock,
    private readonly iconUrls: PlatformIconUrls,
    private readonly files: UploadedImageFiles,
  ) {
    super(PLATFORMS, dataSource, clock);
  }

  protected async afterWrite(manager: EntityManager, platform: Platform, attributes: Partial<Platform>): Promise<AfterCommit | void> {
    const { iconUrl } = attributes;
    if (iconUrl === undefined) return;
    if (!(await this.iconUrls.isUsable(manager, iconUrl))) {
      throw new JsonApiException(HttpStatus.UNPROCESSABLE_ENTITY, [
        { code: 'unknown_platform_icon', detail: this.iconUrls.describe(iconUrl), source: { pointer: '/data/attributes/iconUrl' } },
      ]);
    }
    // On an update `platform` is the entry before it; on a creation it already has the new icon.
    if (platform.iconUrl !== iconUrl) return () => this.files.remove(platform.iconUrl);
  }

  protected async beforeRemove(_manager: EntityManager, platform: Platform): Promise<AfterCommit> {
    return () => this.files.remove(platform.iconUrl);
  }
}

export const PlatformsController = vocabularyController({
  vocabulary: PLATFORMS,
  store: PlatformsStore,
  resource: responseResource('PlatformResource', 'platforms', PlatformResponseAttributes),
  createDocument: requestDocument('PlatformCreate', 'platforms', PlatformAttributes),
  updateDocument: requestDocument('PlatformUpdate', 'platforms', PlatformChanges, { withId: true }),
  singular: 'plataforma',
  plural: 'plataformas',
});
