import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsString, IsUrl, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export const SOURCE_URL_MAX_LENGTH = 2048;
export const CITATION_MAX_LENGTH = 2000;

/** Blank text means no value, so a source is never kept with an empty URL or citation. */
const blankAsNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/**
 * A source has a URL, a citation or both. An omitted member keeps its value
 * and `null` clears it; whether one remains is checked on the whole source.
 */
class SourceAttributes {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: SOURCE_URL_MAX_LENGTH, example: 'https://es.wikipedia.org/wiki/IU_(cantante)' })
  @Transform(blankAsNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'url must be an HTTP(S) URL' })
  @MaxLength(SOURCE_URL_MAX_LENGTH)
  url?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: CITATION_MAX_LENGTH, description: 'Referencia bibliográfica, página o contexto' })
  @Transform(blankAsNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(CITATION_MAX_LENGTH)
  citationText?: string | null;
}

class NewSourceResource {
  @ApiProperty({ enum: ['proposal-sources'] })
  @Equals('proposal-sources')
  type: string;

  @ApiProperty({ type: SourceAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => SourceAttributes)
  attributes: SourceAttributes;
}

export class NewSourceDocument {
  @ApiProperty({ type: NewSourceResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => NewSourceResource)
  data: NewSourceResource;
}

class SourceUpdateResource extends NewSourceResource {
  @ApiProperty({ format: 'uuid', description: 'Id de la fuente de la URL' })
  @IsString()
  id: string;
}

export class SourceUpdateDocument {
  @ApiProperty({ type: SourceUpdateResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => SourceUpdateResource)
  data: SourceUpdateResource;
}
