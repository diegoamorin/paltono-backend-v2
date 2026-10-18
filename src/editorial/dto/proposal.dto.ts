import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsOptional, IsString, IsUUID, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export const DESCRIPTION_MAX_LENGTH = 10_000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ProposalAttributes {
  @ApiPropertyOptional({
    maxLength: DESCRIPTION_MAX_LENGTH,
    description: 'Explicación de la contribución. Puede quedar vacía en el borrador; enviar la exige',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;
}

class ProposalIdentifier {
  @ApiProperty({ enum: ['proposals'] })
  @Equals('proposals')
  type: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

class PreviousProposalRelationship {
  @ApiProperty({ type: ProposalIdentifier, nullable: true, description: 'Un envío propio anterior; null lo quita' })
  @ValidateIf((_, value) => value !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => ProposalIdentifier)
  data: ProposalIdentifier | null;
}

class ProposalRelationships {
  @ApiPropertyOptional({ type: PreviousProposalRelationship })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreviousProposalRelationship)
  previousProposal?: PreviousProposalRelationship;
}

class NewProposalResource {
  @ApiProperty({ enum: ['proposals'] })
  @Equals('proposals')
  type: string;

  @ApiPropertyOptional({ type: ProposalAttributes })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposalAttributes)
  attributes?: ProposalAttributes;

  @ApiPropertyOptional({ type: ProposalRelationships })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProposalRelationships)
  relationships?: ProposalRelationships;
}

export class NewProposalDocument {
  @ApiProperty({ type: NewProposalResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => NewProposalResource)
  data: NewProposalResource;
}

class ProposalUpdateResource extends NewProposalResource {
  @ApiProperty({ format: 'uuid', description: 'Id de la propuesta de la URL' })
  @IsString()
  id: string;
}

export class ProposalUpdateDocument {
  @ApiProperty({ type: ProposalUpdateResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProposalUpdateResource)
  data: ProposalUpdateResource;
}

class SubmissionResource {
  @ApiProperty({ enum: ['submissions'] })
  @Equals('submissions')
  type: string;
}

export class SubmissionDocument {
  @ApiProperty({ type: SubmissionResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => SubmissionResource)
  data: SubmissionResource;
}

class PublicationResource {
  @ApiProperty({ enum: ['publications'] })
  @Equals('publications')
  type: string;
}

export class PublicationDocument {
  @ApiProperty({ type: PublicationResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => PublicationResource)
  data: PublicationResource;
}
