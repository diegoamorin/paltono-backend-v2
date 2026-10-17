import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { CATALOG_IDENTITY_TYPES, CatalogIdentity, Organization, PERSON_GENDERS, Person } from './entities/catalog-identity.entity';

/** A published identity with the row of its subtype. */
export interface IdentityEntry {
  identity: CatalogIdentity;
  person: Person | null;
  organization: Organization | null;
}

const partialDate = (year: number | null, month: number | null, day: number | null) =>
  year === null ? null : { year, month, day };

export const identitySchema = defineResource<IdentityEntry>({
  type: 'identities',
  id: ({ identity }) => identity.publicId,
  attributes: {
    type: ({ identity }) => identity.type,
    displayName: ({ identity }) => identity.displayName,
    imgProfile: ({ identity }) => identity.imgProfile,
    bio: ({ identity }) => identity.bio,
    person: ({ person }) =>
      person && {
        givenName: person.givenName,
        familyName: person.familyName,
        birthDate: person.birthDate,
        deathDate: person.deathDate,
        heightCm: person.heightCm,
        gender: person.gender,
      },
    organization: ({ organization }) =>
      organization && {
        legalName: organization.legalName,
        founding: partialDate(organization.foundingYear, organization.foundingMonth, organization.foundingDay),
        dissolution: partialDate(organization.dissolutionYear, organization.dissolutionMonth, organization.dissolutionDay),
        originCountryId: organization.originCountryId,
      },
    createdAt: ({ identity }) => identity.createdAt.toISOString(),
    updatedAt: ({ identity }) => identity.updatedAt.toISOString(),
  },
  meta: ({ identity }) => ({ editorialEntityId: identity.editorialEntityId }),
});

class PartialDate {
  @ApiProperty({ example: 2008 })
  year: number;

  @ApiProperty({ type: Number, nullable: true, example: 9 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  day: number | null;
}

class PersonAttributes {
  @ApiProperty({ type: String, nullable: true })
  givenName: string | null;

  @ApiProperty({ type: String, nullable: true })
  familyName: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  birthDate: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  deathDate: string | null;

  @ApiProperty({ type: Number, nullable: true })
  heightCm: number | null;

  @ApiProperty({ enum: PERSON_GENDERS, nullable: true })
  gender: string | null;
}

class OrganizationAttributes {
  @ApiProperty({ type: String, nullable: true })
  legalName: string | null;

  @ApiProperty({ type: PartialDate, nullable: true, description: 'Fecha parcial: los nulos marcan la precisión desconocida' })
  founding: PartialDate | null;

  @ApiProperty({ type: PartialDate, nullable: true })
  dissolution: PartialDate | null;

  @ApiProperty({ type: Number, nullable: true, description: 'id del país en /v1/countries' })
  originCountryId: number | null;
}

class IdentityAttributes {
  @ApiProperty({ enum: CATALOG_IDENTITY_TYPES })
  type: string;

  @ApiProperty({ example: 'IU' })
  displayName: string;

  @ApiProperty({ type: String, nullable: true })
  imgProfile: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty({ type: PersonAttributes, nullable: true, description: 'Solo en una persona' })
  person: PersonAttributes | null;

  @ApiProperty({ type: OrganizationAttributes, nullable: true, description: 'Solo en una organización' })
  organization: OrganizationAttributes | null;

  @ApiProperty({ format: 'date-time', description: 'Fecha de publicación de la ficha' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

class EntryMeta {
  @ApiProperty({ format: 'uuid', description: 'UUID editorial con el que se proponen cambios a la ficha' })
  editorialEntityId: string;
}

export class IdentityResource {
  @ApiProperty({ enum: ['identities'] })
  type: string;

  @ApiProperty({ description: 'public_id de la identidad' })
  id: string;

  @ApiProperty({ type: IdentityAttributes })
  attributes: IdentityAttributes;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}
