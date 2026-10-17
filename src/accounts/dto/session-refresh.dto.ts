import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class SessionRefreshAttributes {
  @ApiPropertyOptional({ description: 'Token de renovación de clientes mobile; los navegadores envían la cookie en su lugar' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken?: string;
}

class SessionRefreshResource {
  @ApiProperty({ enum: ['session-refreshes'] })
  @Equals('session-refreshes')
  type: string;

  @ApiPropertyOptional({ type: SessionRefreshAttributes })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionRefreshAttributes)
  attributes?: SessionRefreshAttributes;
}

/**
 * Required even when the token travels in the cookie: its JSON:API media type
 * makes a cross-site browser request preflighted, which guards against CSRF.
 */
export class SessionRefreshDocument {
  @ApiProperty({ type: SessionRefreshResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => SessionRefreshResource)
  data: SessionRefreshResource;
}
