import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { CATALOG_IDENTITY_TYPES, CatalogIdentity, Organization, PERSON_GENDERS, Person } from './entities/catalog-identity.entity';

/** A published identity with the row of its subtype, or a withdrawn one with neither. */
export interface IdentityEntry {
  identity: CatalogIdentity;
  person: Person | null;
  organization: Organization | null;
}

const partialDate = (year: number | null, month: number | null, day: number | null) =>
  year === null ? null : { year, month, day };

const isWithdrawn = ({ identity }: IdentityEntry) => identity.editorialEntity!.publicationStatus === 'withdrawn';

/** An attribute of the entry's content, which a withdrawn entry leaves out: it only shows the notice. */
const content =
  (read: (entry: IdentityEntry) => unknown) =>
  (entry: IdentityEntry): unknown =>
    isWithdrawn(entry) ? undefined : read(entry);

export const identitySchema = defineResource<IdentityEntry>({
  type: 'identities',
  id: ({ identity }) => identity.publicId,
  attributes: {
    publicationStatus: ({ identity }) => identity.editorialEntity!.publicationStatus,
    withdrawnAt: ({ identity }) => identity.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    type: content(({ identity }) => identity.type),
    displayName: content(({ identity }) => identity.displayName),
    imgProfile: content(({ identity }) => identity.imgProfile),
    bio: content(({ identity }) => identity.bio),
    person: content(({ person }) =>
      person && {
        givenName: person.givenName,
        familyName: person.familyName,
        birthDate: person.birthDate,
        deathDate: person.deathDate,
        heightCm: person.heightCm,
        gender: person.gender,
      },
    ),
    organization: content(({ organization }) =>
      organization && {
        legalName: organization.legalName,
        founding: partialDate(organization.foundingYear, organization.foundingMonth, organization.foundingDay),
        dissolution: partialDate(organization.dissolutionYear, organization.dissolutionMonth, organization.dissolutionDay),
        originCountryId: organization.originCountryId,
      },
    ),
    createdAt: content(({ identity }) => identity.createdAt.toISOString()),
    updatedAt: content(({ identity }) => identity.updatedAt.toISOString()),
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

const WITHDRAWN = 'Ausente en una ficha retirada';

class IdentityAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Una ficha retirada solo muestra este aviso y `withdrawnAt`' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ enum: CATALOG_IDENTITY_TYPES, required: false, description: WITHDRAWN })
  type?: string;

  @ApiProperty({ example: 'IU', required: false, description: WITHDRAWN })
  displayName?: string;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  imgProfile?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: WITHDRAWN })
  bio?: string | null;

  @ApiProperty({ type: PersonAttributes, nullable: true, required: false, description: `Solo en una persona. ${WITHDRAWN}` })
  person?: PersonAttributes | null;

  @ApiProperty({ type: OrganizationAttributes, nullable: true, required: false, description: `Solo en una organización. ${WITHDRAWN}` })
  organization?: OrganizationAttributes | null;

  @ApiProperty({ format: 'date-time', required: false, description: `Fecha de publicación de la ficha. ${WITHDRAWN}` })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
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
