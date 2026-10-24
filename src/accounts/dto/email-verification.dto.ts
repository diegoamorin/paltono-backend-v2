import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class EmailVerificationAttributes {
  @ApiProperty({ description: 'Token recibido en el enlace del correo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

class EmailVerificationResource {
  @ApiProperty({ enum: ['email-verifications'] })
  @Equals('email-verifications')
  type: string;

  @ApiProperty({ type: EmailVerificationAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailVerificationAttributes)
  attributes: EmailVerificationAttributes;
}

export class EmailVerificationDocument {
  @ApiProperty({ type: EmailVerificationResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailVerificationResource)
  data: EmailVerificationResource;
}

/** No attributes: the link always goes to the main app. Any attribute is rejected. */
class EmailVerificationRequestAttributes {}

class EmailVerificationRequestResource {
  @ApiProperty({ enum: ['email-verification-requests'] })
  @Equals('email-verification-requests')
  type: string;

  @ApiPropertyOptional({ type: EmailVerificationRequestAttributes })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmailVerificationRequestAttributes)
  attributes?: EmailVerificationRequestAttributes;
}

export class EmailVerificationRequestDocument {
  @ApiProperty({ type: EmailVerificationRequestResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => EmailVerificationRequestResource)
  data: EmailVerificationRequestResource;
}
