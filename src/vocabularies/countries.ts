import { Injectable, applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { collectionQuery } from '../common/json-api/query';
import { defineResource } from '../common/json-api/resource-schema';
import { Country } from './entities/country.entity';
import { IfPresent, NAME_MAX_LENGTH, NameValidation, requestDocument, responseResource } from './vocabulary-documents';
import { Vocabulary, VocabularyStore, containsFilter, equalsFilter } from './vocabulary-store';
import { vocabularyController } from './vocabulary.controller';

const schema = defineResource<Country>({
  type: 'countries',
  id: (country) => String(country.id),
  attributes: { code: (country) => country.code, name: (country) => country.name },
});

export const COUNTRIES: Vocabulary<Country> = {
  type: 'countries',
  entity: Country,
  schema,
  query: collectionQuery(schema, { sort: ['name', 'code'], defaultSort: 'name', filters: ['q', 'code'] }),
  filters: { q: containsFilter('name'), code: equalsFilter('code', (code) => code.toUpperCase()) },
  uniqueAttributes: { countries_code_key: 'code' },
};

const CodeValidation = () =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)),
    IsString(),
    Matches(/^[A-Z]{2}$/, { message: 'code must be two ASCII letters' }),
  );

class CountryAttributes {
  @ApiProperty({ example: 'KR', description: 'Código de dos letras; se guarda en mayúsculas' })
  @CodeValidation()
  code: string;

  @ApiProperty({ example: 'Corea del Sur', maxLength: NAME_MAX_LENGTH })
  @NameValidation()
  name: string;
}

class CountryChanges {
  @ApiPropertyOptional({ example: 'KR' })
  @IfPresent()
  @CodeValidation()
  code?: string;

  @ApiPropertyOptional({ maxLength: NAME_MAX_LENGTH })
  @IfPresent()
  @NameValidation()
  name?: string;
}

class CountryResponseAttributes {
  @ApiProperty({ example: 'KR' })
  code: string;

  @ApiProperty({ example: 'Corea del Sur' })
  name: string;
}

@Injectable()
export class CountriesStore extends VocabularyStore<Country> {
  constructor(dataSource: DataSource, clock: Clock) {
    super(COUNTRIES, dataSource, clock);
  }
}

export const CountriesController = vocabularyController({
  vocabulary: COUNTRIES,
  store: CountriesStore,
  resource: responseResource('CountryResource', 'countries', CountryResponseAttributes),
  createDocument: requestDocument('CountryCreate', 'countries', CountryAttributes),
  updateDocument: requestDocument('CountryUpdate', 'countries', CountryChanges, { withId: true }),
  singular: 'país',
  plural: 'países',
});
