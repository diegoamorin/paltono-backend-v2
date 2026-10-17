import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, IsInt, IsString, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export const MANUAL_DECISION_ACTIONS = ['apply', 'apply_rebased', 'reject', 'withdraw_change'] as const;
export type ManualDecisionAction = (typeof MANUAL_DECISION_ACTIONS)[number];

export const REASON_MAX_LENGTH = 10_000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class DecisionAttributes {
  @ApiProperty({
    enum: MANUAL_DECISION_ACTIONS,
    description:
      '`apply` incorpora el microcambio a la ficha si su base no cambió; `apply_rebased` lo incorpora sobre la base actual ' +
      'de un microcambio en conflicto; `reject` lo descarta; `withdraw_change` lo retira de la revisión, también a petición de su autor',
  })
  @IsIn(MANUAL_DECISION_ACTIONS)
  action: ManualDecisionAction;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Versión actual de la ficha que el personal confirma; obligatoria con `apply_rebased` y no admitida con otras acciones',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  confirmedVersion?: number | null;

  @ApiPropertyOptional({ maxLength: REASON_MAX_LENGTH, description: 'Motivo de la decisión; obligatorio al rechazar y al aplicar sobre una base nueva' })
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
