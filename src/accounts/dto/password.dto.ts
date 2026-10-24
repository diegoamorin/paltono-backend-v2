import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsEmail, IsNotEmpty, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../account-rules';

class PasswordResetRequestAttributes {
  @ApiProperty({ example: 'diego@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;
}

class PasswordResetRequestResource {
  @ApiProperty({ enum: ['password-reset-requests'] })
  @Equals('password-reset-requests')
  type: string;

  @ApiProperty({ type: PasswordResetRequestAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordResetRequestAttributes)
  attributes: PasswordResetRequestAttributes;
}

export class PasswordResetRequestDocument {
  @ApiProperty({ type: PasswordResetRequestResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordResetRequestResource)
  data: PasswordResetRequestResource;
}

class PasswordResetAttributes {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;
}

class PasswordResetResource {
  @ApiProperty({ enum: ['password-resets'] })
  @Equals('password-resets')
  type: string;

  @ApiProperty({ type: PasswordResetAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordResetAttributes)
  attributes: PasswordResetAttributes;
}

export class PasswordResetDocument {
  @ApiProperty({ type: PasswordResetResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordResetResource)
  data: PasswordResetResource;
}

class PasswordChangeAttributes {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword: string;
}

class PasswordChangeResource {
  @ApiProperty({ enum: ['password-changes'] })
  @Equals('password-changes')
  type: string;

  @ApiProperty({ type: PasswordChangeAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordChangeAttributes)
  attributes: PasswordChangeAttributes;
}

export class PasswordChangeDocument {
  @ApiProperty({ type: PasswordChangeResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => PasswordChangeResource)
  data: PasswordChangeResource;
}
