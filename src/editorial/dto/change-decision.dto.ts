import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export const MANUAL_DECISION_ACTIONS = ['apply', 'reject'] as const;
export type ManualDecisionAction = (typeof MANUAL_DECISION_ACTIONS)[number];

export const REASON_MAX_LENGTH = 10_000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class DecisionAttributes {
  @ApiProperty({ enum: MANUAL_DECISION_ACTIONS, description: '`apply` incorpora el microcambio a la ficha; `reject` lo descarta' })
  @IsIn(MANUAL_DECISION_ACTIONS)
  action: ManualDecisionAction;

  @ApiPropertyOptional({ maxLength: REASON_MAX_LENGTH, description: 'Motivo de la decisión; obligatorio al rechazar' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  reason?: string | null;
}

class DecisionResource {
  @ApiProperty({ enum: ['change-decisions'] })
  @Equals('change-decisions')
  type: string;

  @ApiProperty({ type: DecisionAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => DecisionAttributes)
  attributes: DecisionAttributes;
}

export class DecisionDocument {
  @ApiProperty({ type: DecisionResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => DecisionResource)
  data: DecisionResource;
}
