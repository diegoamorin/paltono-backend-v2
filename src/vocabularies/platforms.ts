import { Injectable, applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { collectionQuery, requireOneOf } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
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
import { Vocabulary, VocabularyStore, containsFilter, equalsFilter } from './vocabulary-store';
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
  uniqueAttributes: { platforms_name_key: 'name', platforms_slug_key: 'slug' },
  timestamps: true,
};

// Any HTTP(S) URL: a platform's icon is vocabulary that admins curate, not a catalog image under ADR 0005's upload rule.
const IconUrlValidation = () =>
  applyDecorators(IsUrl({ protocols: ['http', 'https'], require_protocol: true }), MaxLength(2048));

class PlatformAttributes {
  @ApiProperty({ example: 'Spotify', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;

  @ApiProperty({ example: 'spotify', maxLength: SLUG_MAX_LENGTH })
  @SlugValidation()
  slug: string;

  @ApiProperty({ example: 'https://cdn.example.com/spotify.svg', description: 'URL HTTP(S)' })
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

  @ApiPropertyOptional()
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

@Injectable()
export class PlatformsStore extends VocabularyStore<Platform> {
  constructor(dataSource: DataSource, clock: Clock) {
    super(PLATFORMS, dataSource, clock);
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
