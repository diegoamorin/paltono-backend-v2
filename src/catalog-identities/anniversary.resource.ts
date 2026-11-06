import { ApiProperty } from '@nestjs/swagger';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { BirthDate } from '../common/partial-date/partial-date';
import { IdentityEntry, identitySchema } from './identity.resource';

export const ANNIVERSARY_KINDS = ['birth', 'death', 'debut', 'founding', 'dissolution'] as const;
export type AnniversaryKind = (typeof ANNIVERSARY_KINDS)[number];

/** A date of a published identity that recurs every year. */
export interface AnniversaryEntry {
  kind: AnniversaryKind;
  /** Only a birth may have a null year. */
  date: BirthDate;
  identity: IdentityEntry;
}

export const anniversarySchema: ResourceSchema<AnniversaryEntry> = defineResource({
  type: 'anniversaries',
  id: ({ identity, kind }) => `${identity.identity.publicId}:${kind}`,
  attributes: { kind: ({ kind }) => kind, date: ({ date }) => date },
  relationships: { identity: { schema: () => identitySchema, get: ({ identity }) => identity } },
});

class AnniversaryAttributes {
  @ApiProperty({ enum: ANNIVERSARY_KINDS })
  kind: string;

  @ApiProperty({ type: BirthDate, description: 'Fecha parcial con mes conocido: los nulos marcan la precisión desconocida, y `year: null` es un cumpleaños sin año' })
  date: BirthDate;
}

class AnniversaryIdentityLinkage {
  @ApiProperty({ type: ResourceIdentifier })
  data: ResourceIdentifier;
}

class AnniversaryRelationships {
  @ApiProperty({ type: AnniversaryIdentityLinkage, description: '`identities`: la identidad de la fecha' })
  identity: AnniversaryIdentityLinkage;
}

export class AnniversaryResource {
  @ApiProperty({ enum: ['anniversaries'] })
  type: string;

  @ApiProperty({ description: 'public_id de la identidad y `kind`, separados por dos puntos' })
  id: string;

  @ApiProperty({ type: AnniversaryAttributes })
  attributes: AnniversaryAttributes;

  @ApiProperty({ type: AnniversaryRelationships })
  relationships: AnniversaryRelationships;
}
