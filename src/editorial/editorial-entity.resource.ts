import { ApiProperty } from '@nestjs/swagger';
import { AccountLinkage, publicAccountSchema } from '../accounts/account.resource';
import { defineResource } from '../common/json-api/resource-schema';
import { EDITORIAL_ENTITY_TYPES, EditorialEntity, PUBLICATION_STATUSES } from './entities/editorial-entity.entity';

/** The editorial state of a root, loaded with its creator. */
export const editorialEntitySchema = defineResource<EditorialEntity>({
  type: 'editorial-entities',
  id: (entity) => entity.id,
  attributes: {
    entityType: (entity) => entity.entityType,
    publicationStatus: (entity) => entity.publicationStatus,
    currentVersion: (entity) => entity.currentVersion,
    createdAt: (entity) => entity.createdAt.toISOString(),
    publishedAt: (entity) => entity.publishedAt?.toISOString() ?? null,
    withdrawnAt: (entity) => entity.withdrawnAt?.toISOString() ?? null,
  },
  relationships: {
    createdBy: { schema: () => publicAccountSchema, get: (entity) => entity.createdBy },
  },
});

class EditorialEntityAttributes {
  @ApiProperty({ enum: EDITORIAL_ENTITY_TYPES })
  entityType: string;

  @ApiProperty({ enum: PUBLICATION_STATUSES })
  publicationStatus: string;

  @ApiProperty({ description: 'Microcambios aplicados; 0 en una reserva' })
  currentVersion: number;

  @ApiProperty({ format: 'date-time', description: 'Fecha de la reserva' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;
}

class EditorialEntityRelationships {
  @ApiProperty({ type: AccountLinkage, description: 'Autor de la reserva y del alta' })
  createdBy: AccountLinkage;
}

export class EditorialEntityResource {
  @ApiProperty({ enum: ['editorial-entities'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: EditorialEntityAttributes })
  attributes: EditorialEntityAttributes;

  @ApiProperty({ type: EditorialEntityRelationships })
  relationships: EditorialEntityRelationships;
}
