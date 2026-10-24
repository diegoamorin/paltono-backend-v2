import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsEmail, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  normalizeUsername,
} from '../account-rules';

class RegistrationAttributes {
  @ApiProperty({
    example: 'diego_papi',
    description: 'Letras ASCII, dígitos, _ y .; sin punto final; de 1 a 30 caracteres. Se guarda en minúsculas.',
  })
  @Transform(({ value }) => normalizeUsername(value))
  @IsString()
  @Matches(USERNAME_PATTERN, {
    message: 'username must have 1 to 30 ASCII letters, digits, _ or ., and must not end with a period',
  })
  username: string;

  @ApiProperty({ example: 'diego@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({ example: 'Diego', maxLength: DISPLAY_NAME_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName: string;
}

class RegistrationResource {
  @ApiProperty({ enum: ['users'] })
  @Equals('users')
  type: string;

  @ApiProperty({ type: RegistrationAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => RegistrationAttributes)
  attributes: RegistrationAttributes;
}

export class RegistrationDocument {
  @ApiProperty({ type: RegistrationResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => RegistrationResource)
  data: RegistrationResource;
}
