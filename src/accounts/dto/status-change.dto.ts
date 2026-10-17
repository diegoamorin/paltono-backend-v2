import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { USER_STATUSES, UserStatus } from '../entities/user.entity';
import { REASON_MAX_LENGTH } from './role-change.dto';

class StatusChangeAttributes {
  @ApiProperty({
    enum: USER_STATUSES,
    description: '`suspended` suspende, `active` reactiva y `deleted` da de baja una cuenta suspendida',
  })
  @IsIn(USER_STATUSES)
  newStatus: UserStatus;

  @ApiProperty({ maxLength: REASON_MAX_LENGTH, description: 'Motivo administrativo; no es público ni se muestra a la cuenta' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(REASON_MAX_LENGTH)
  reason: string;
}

class StatusChangeResource {
  @ApiProperty({ enum: ['status-changes'] })
  @Equals('status-changes')
  type: string;

  @ApiProperty({ type: StatusChangeAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => StatusChangeAttributes)
  attributes: StatusChangeAttributes;
}

export class StatusChangeDocument {
  @ApiProperty({ type: StatusChangeResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => StatusChangeResource)
  data: StatusChangeResource;
}
