import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsArray, IsUUID, ValidateNested } from 'class-validator';

class ChangeIdentifier {
  @ApiProperty({ enum: ['proposal-changes'] })
  @Equals('proposal-changes')
  type: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

class SourceIdentifier {
  @ApiProperty({ enum: ['proposal-sources'] })
  @Equals('proposal-sources')
  type: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

/** Microchanges of the same draft that a microchange depends on. */
export class DependenciesDocument {
  @ApiProperty({ type: [ChangeIdentifier] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangeIdentifier)
  data: ChangeIdentifier[];
}

/** General sources of the same draft that back a microchange. */
export class ChangeSourcesDocument {
  @ApiProperty({ type: [SourceIdentifier] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceIdentifier)
  data: SourceIdentifier[];
}
