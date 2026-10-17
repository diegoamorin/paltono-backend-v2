import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { USER_ROLES, UserRole } from '../entities/user.entity';

export const REASON_MAX_LENGTH = 1000;

class RoleChangeAttributes {
  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  newRole: UserRole;

  @ApiProperty({ maxLength: REASON_MAX_LENGTH, description: 'Motivo administrativo; no es público' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(REASON_MAX_LENGTH)
  reason: string;
}

class RoleChangeResource {
  @ApiProperty({ enum: ['role-changes'] })
  @Equals('role-changes')
  type: string;

  @ApiProperty({ type: RoleChangeAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => RoleChangeAttributes)
  attributes: RoleChangeAttributes;
}

export class RoleChangeDocument {
  @ApiProperty({ type: RoleChangeResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => RoleChangeResource)
  data: RoleChangeResource;
}
