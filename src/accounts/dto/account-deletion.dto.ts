import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../account-rules';

class AccountDeletionAttributes {
  @ApiProperty({ description: 'Contraseña actual' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

class AccountDeletionResource {
  @ApiProperty({ enum: ['account-deletions'] })
  @Equals('account-deletions')
  type: string;

  @ApiProperty({ type: AccountDeletionAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => AccountDeletionAttributes)
  attributes: AccountDeletionAttributes;
}

export class AccountDeletionDocument {
  @ApiProperty({ type: AccountDeletionResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => AccountDeletionResource)
  data: AccountDeletionResource;
}
