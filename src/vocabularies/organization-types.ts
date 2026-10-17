import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { collectionQuery } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
import { OrganizationType } from './entities/organization-type.entity';
import {
  DESCRIPTION_MAX_LENGTH,
  DescriptionValidation,
  IfPresent,
  IfPresentAndNotNull,
  NAME_MAX_LENGTH,
  NameValidation,
  SLUG_MAX_LENGTH,
  SlugValidation,
  requestDocument,
  responseResource,
} from './vocabulary-documents';
import { Vocabulary, VocabularyStore, containsFilter, equalsFilter } from './vocabulary-store';
import { vocabularyController } from './vocabulary.controller';

const schema = defineResource<OrganizationType>({
  type: 'organization-types',
  id: (type) => String(type.id),
  attributes: { slug: (type) => type.slug, name: (type) => type.name, description: (type) => type.description },
});

export const ORGANIZATION_TYPES: Vocabulary<OrganizationType> = {
  type: 'organization-types',
  entity: OrganizationType,
  schema,
  query: collectionQuery(schema, { sort: ['name'], defaultSort: 'name', filters: ['q', 'slug'] }),
  filters: { q: containsFilter('name'), slug: equalsFilter('slug') },
  uniqueAttributes: { organization_types_slug_key: 'slug' },
};

class OrganizationTypeAttributes {
  @ApiProperty({ example: 'agency', maxLength: SLUG_MAX_LENGTH })
  @SlugValidation()
  slug: string;

  @ApiProperty({ example: 'Agencia', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @DescriptionValidation()
  description?: string | null;
}

class OrganizationTypeChanges {
  @ApiPropertyOptional({ example: 'agency', maxLength: SLUG_MAX_LENGTH })
  @IfPresent()
  @SlugValidation()
  slug?: string;

  @ApiPropertyOptional({ maxLength: NAME_MAX_LENGTH })
  @IfPresent()
  @NameValidation()
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX_LENGTH, description: 'null la borra' })
  @IfPresentAndNotNull()
  @DescriptionValidation()
  description?: string | null;
}

class OrganizationTypeResponseAttributes {
  @ApiProperty({ example: 'agency' })
  slug: string;

  @ApiProperty({ example: 'Agencia' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;
}

@Injectable()
export class OrganizationTypesStore extends VocabularyStore<OrganizationType> {
  constructor(dataSource: DataSource, clock: Clock) {
    super(ORGANIZATION_TYPES, dataSource, clock);
  }
}

export const OrganizationTypesController = vocabularyController({
  vocabulary: ORGANIZATION_TYPES,
  store: OrganizationTypesStore,
  resource: responseResource('OrganizationTypeResource', 'organization-types', OrganizationTypeResponseAttributes),
  createDocument: requestDocument('OrganizationTypeCreate', 'organization-types', OrganizationTypeAttributes),
  updateDocument: requestDocument('OrganizationTypeUpdate', 'organization-types', OrganizationTypeChanges, { withId: true }),
  singular: 'tipo de organización',
  plural: 'tipos de organización',
});
