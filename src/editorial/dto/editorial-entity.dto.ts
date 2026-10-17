import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsDefined, IsIn, ValidateNested } from 'class-validator';
import { EditorialEntityType } from '../entities/editorial-entity.entity';
import { creatableEntityTypes } from '../operation-registry';

class ReservationAttributes {
  @ApiProperty({ enum: creatableEntityTypes(), description: 'Tipo de raíz; solo los que tienen un alta registrada en E1' })
  @IsIn(creatableEntityTypes())
  entityType: EditorialEntityType;
}

class ReservationResource {
  @ApiProperty({ enum: ['editorial-entities'] })
  @Equals('editorial-entities')
  type: string;

  @ApiProperty({ type: ReservationAttributes })
  @IsDefined()
  @ValidateNested()
  @Type(() => ReservationAttributes)
  attributes: ReservationAttributes;
}

export class ReservationDocument {
  @ApiProperty({ type: ReservationResource })
  @IsDefined()
  @ValidateNested()
  @Type(() => ReservationResource)
  data: ReservationResource;
}
