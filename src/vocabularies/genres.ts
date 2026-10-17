import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { collectionQuery } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
import { Genre } from './entities/genre.entity';
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

const schema = defineResource<Genre>({
  type: 'genres',
  id: (genre) => String(genre.id),
  attributes: { slug: (genre) => genre.slug, name: (genre) => genre.name },
});

export const GENRES: Vocabulary<Genre> = {
  type: 'genres',
  entity: Genre,
  schema,
  query: collectionQuery(schema, { sort: ['name'], defaultSort: 'name', filters: ['q', 'slug'] }),
  filters: { q: containsFilter('name'), slug: equalsFilter('slug') },
  uniqueAttributes: { genres_slug_key: 'slug' },
};

class GenreAttributes {
  @ApiProperty({ example: 'k-pop', maxLength: SLUG_MAX_LENGTH })
  @SlugValidation()
  slug: string;

  @ApiProperty({ example: 'K-pop', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;
}

class GenreChanges {
  @ApiPropertyOptional({ example: 'k-pop', maxLength: SLUG_MAX_LENGTH })
  @IfPresent()
  @SlugValidation()
  slug?: string;

  @ApiPropertyOptional({ maxLength: NAME_MAX_LENGTH })
  @IfPresent()
  @NameValidation()
  name?: string;
}

class GenreResponseAttributes {
  @ApiProperty({ example: 'k-pop' })
  slug: string;

  @ApiProperty({ example: 'K-pop' })
  name: string;
}

@Injectable()
export class GenresStore extends VocabularyStore<Genre> {
  constructor(dataSource: DataSource, clock: Clock) {
    super(GENRES, dataSource, clock);
  }
}

export const GenresController = vocabularyController({
  vocabulary: GENRES,
  store: GenresStore,
  resource: responseResource('GenreResource', 'genres', GenreResponseAttributes),
  createDocument: requestDocument('GenreCreate', 'genres', GenreAttributes),
  updateDocument: requestDocument('GenreUpdate', 'genres', GenreChanges, { withId: true }),
  singular: 'género',
  plural: 'géneros',
});
