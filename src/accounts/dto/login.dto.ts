import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../account-rules';

export const CLIENTS = ['web', 'mobile'] as const;
export type Client = (typeof CLIENTS)[number];

class LoginAttributes {
  @ApiProperty({ example: 'diego_papi', description: 'Username o correo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({
    enum: CLIENTS,
    description: 'web recibe el token de renovación en una cookie HttpOnly; mobile, en meta.refreshToken',
  })
  @IsIn(CLIENTS)
  client: Client;
}

class LoginResource {
  @ApiProperty({ enum: ['sessions'] })
  @Equals('sessions')
  type: string;

  @ApiProperty({ type: LoginAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => LoginAttributes)
  attributes: LoginAttributes;
}

export class LoginDocument {
  @ApiProperty({ type: LoginResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => LoginResource)
  data: LoginResource;
}
