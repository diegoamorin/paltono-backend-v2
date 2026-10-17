import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { FRONTENDS, Frontend } from '../../config/app-config';
import { PASSWORD_MAX_LENGTH } from '../account-rules';

class EmailChangeRequestAttributes {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ example: 'nuevo@example.com', description: 'Se guarda en minúsculas' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  newEmail: string;

  @ApiPropertyOptional({ enum: FRONTENDS, default: 'kpop', description: 'Frontend al que apunta el enlace del correo' })
  @IsOptional()
  @IsIn(FRONTENDS)
  frontend?: Frontend;
}

class EmailChangeRequestResource {
  @ApiProperty({ enum: ['email-change-requests'] })
  @Equals('email-change-requests')
  type: string;

  @ApiProperty({ type: EmailChangeRequestAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailChangeRequestAttributes)
  attributes: EmailChangeRequestAttributes;
}

export class EmailChangeRequestDocument {
  @ApiProperty({ type: EmailChangeRequestResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailChangeRequestResource)
  data: EmailChangeRequestResource;
}

class EmailChangeAttributes {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

class EmailChangeResource {
  @ApiProperty({ enum: ['email-changes'] })
  @Equals('email-changes')
  type: string;

  @ApiProperty({ type: EmailChangeAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailChangeAttributes)
  attributes: EmailChangeAttributes;
}

export class EmailChangeDocument {
  @ApiProperty({ type: EmailChangeResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailChangeResource)
  data: EmailChangeResource;
}
