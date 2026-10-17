import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsDefined, IsString, IsUrl, Length, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import {
  AVATAR_URL_MAX_LENGTH,
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_PATTERN,
  normalizeUsername,
} from '../account-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Every attribute is optional; an absent one keeps its value, and `null` clears the avatar or the bio. */
class ProfileAttributes {
  @ApiPropertyOptional({
    example: 'dieguito',
    description:
      'Letras ASCII, dígitos, _ y .; sin punto final; de 1 a 30 caracteres; se guarda en minúsculas. Se puede cambiar ' +
      'cuando han pasado 7 días completos desde el último cambio; enviar el username vigente no reinicia el plazo.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => normalizeUsername(value))
  @IsString()
  @Matches(USERNAME_PATTERN, {
    message: 'username must have 1 to 30 ASCII letters, digits, _ or ., and must not end with a period',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'Diego', maxLength: DISPLAY_NAME_MAX_LENGTH, description: 'Admite Unicode' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: AVATAR_URL_MAX_LENGTH, description: 'URL HTTP(S) de la imagen' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'avatarUrl must be an HTTP(S) URL' })
  @MaxLength(AVATAR_URL_MAX_LENGTH)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: BIO_MAX_LENGTH, description: 'Vacía equivale a null' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(BIO_MAX_LENGTH)
  bio?: string | null;
}

class ProfileResource {
  @ApiProperty({ enum: ['users'] })
  @Equals('users')
  type: string;

  @ApiProperty({ format: 'uuid', description: 'UUID de la cuenta propia' })
  @IsString()
  id: string;

  @ApiProperty({ type: ProfileAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProfileAttributes)
  attributes: ProfileAttributes;
}

export class ProfileDocument {
  @ApiProperty({ type: ProfileResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProfileResource)
  data: ProfileResource;
}
