import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  Equals,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CHANGE_OPERATIONS } from '../entities/proposal-change.entity';

const POSITION_MAX = 1_000_000;

const ifPresent = () => ValidateIf((_, value) => value !== undefined);

const ProposedValue = (required: boolean) =>
  applyDecorators(
    ApiProperty({ type: Object, required, description: 'Envoltura `{"exists": true, "value": ...}` validada contra E1' }),
    required ? IsDefined() : ifPresent(),
    IsObject(),
  );

const PayloadSchemaVersion = () =>
  applyDecorators(
    ApiPropertyOptional({
      example: 1,
      description: 'Versión del payload; sin ella, la vigente del selector en E1. Una versión obsoleta responde 422 `obsolete_payload_schema_version`',
    }),
    ifPresent(),
    IsInt(),
    Min(1),
  );

const AtomicGroupId = () =>
  applyDecorators(
    ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Grupo atómico dentro de esta propuesta' }),
    ValidateIf((_, value) => value !== undefined && value !== null),
    IsUUID(),
  );

const Position = () =>
  applyDecorators(
    ApiPropertyOptional({ minimum: 0, description: 'Orden estable dentro de la propuesta; por defecto, detrás del último' }),
    ifPresent(),
    IsInt(),
    Min(0),
    Max(POSITION_MAX),
  );

class NewChangeAttributes {
  @ApiProperty({ enum: CHANGE_OPERATIONS, description: 'Operación del registro E1' })
  @IsString()
  @MaxLength(100)
  operation: string;

  @ApiProperty({ example: 'catalog_identities', description: 'Selector del registro E1' })
  @IsString()
  @MaxLength(100)
  targetPath: string;

  @ApiPropertyOptional({ nullable: true, description: 'Clave de fila con la forma de E1; null para la raíz' })
  @Allow()
  targetKey?: unknown;

  @ProposedValue(true)
  proposedValue: object;

  @PayloadSchemaVersion()
  payloadSchemaVersion?: number;

  @AtomicGroupId()
  atomicGroupId?: string | null;

  @Position()
  position?: number;
}

/** What can still change in a microchange of a draft; an omitted member keeps its value. */
class ChangeUpdateAttributes {
  @ProposedValue(false)
  proposedValue?: object;

  @PayloadSchemaVersion()
  payloadSchemaVersion?: number;

  @AtomicGroupId()
  atomicGroupId?: string | null;

  @Position()
  position?: number;
}

class EntityIdentifier {
  @ApiProperty({ enum: ['editorial-entities'] })
  @Equals('editorial-entities')
  type: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

class EntityRelationship {
  @ApiProperty({ type: EntityIdentifier })
  @IsDefined()
  @ValidateNested()
  @Type(() => EntityIdentifier)
  data: EntityIdentifier;
}

class ChangeRelationships {
  @ApiProperty({ type: EntityRelationship, description: 'Raíz editorial que posee los datos' })
  @IsDefined()
  @ValidateNested()
  @Type(() => EntityRelationship)
  entity: EntityRelationship;
}

class NewChangeResource {
  @ApiProperty({ enum: ['proposal-changes'] })
  @Equals('proposal-changes')
  type: string;

  @ApiProperty({ type: NewChangeAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => NewChangeAttributes)
  attributes: NewChangeAttributes;

  @ApiProperty({ type: ChangeRelationships })
  @IsDefined()
  @ValidateNested()
  @Type(() => ChangeRelationships)
  relationships: ChangeRelationships;
}

export class NewChangeDocument {
  @ApiProperty({ type: NewChangeResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => NewChangeResource)
  data: NewChangeResource;
}

class ChangeUpdateResource {
  @ApiProperty({ enum: ['proposal-changes'] })
  @Equals('proposal-changes')
  type: string;

  @ApiProperty({ format: 'uuid', description: 'Id del microcambio de la URL' })
  @IsString()
  id: string;

  @ApiProperty({ type: ChangeUpdateAttributes })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChangeUpdateAttributes)
  attributes?: ChangeUpdateAttributes;
}

export class ChangeUpdateDocument {
  @ApiProperty({ type: ChangeUpdateResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => ChangeUpdateResource)
  data: ChangeUpdateResource;
}
