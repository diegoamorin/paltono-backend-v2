import { ApiProperty } from '@nestjs/swagger';
import { ArtistEntry, artistSchema } from './artist.resource';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { Country } from '../vocabularies/entities/country.entity';
import { OrganizationType } from '../vocabularies/entities/organization-type.entity';
import { COUNTRIES } from '../vocabularies/countries';
import { ORGANIZATION_TYPES } from '../vocabularies/organization-types';
import { PLATFORMS } from '../vocabularies/platforms';
import { CATALOG_IDENTITY_TYPES, CatalogIdentity, Organization, PERSON_GENDERS, Person } from './entities/catalog-identity.entity';
import { CatalogIdentityAlias, CatalogIdentityPlatformLink } from './entities/identity-relation.entity';

/** What a published identity relates to; a withdrawn one shows none of it. */
export interface IdentityRelations {
  aliases: CatalogIdentityAlias[];
  nationalities: Country[];
  birthCountry: Country | null;
  originCountry: Country | null;
  organizationTypes: OrganizationType[];
  /** With their platforms. */
  platformLinks: CatalogIdentityPlatformLink[];
  artist: ArtistEntry | null;
}

/** A published identity with the row of its subtype and its relations, or a withdrawn one with none of them. */
export interface IdentityEntry {
  identity: CatalogIdentity;
  person: Person | null;
  organization: Organization | null;
  relations: IdentityRelations | null;
}

export const identityAliasSchema = defineResource<CatalogIdentityAlias>({
  type: 'identity-aliases',
  id: (alias) => String(alias.id),
  attributes: { alias: (alias) => alias.alias, isPrimary: (alias) => alias.isPrimary, sortOrder: (alias) => alias.sortOrder },
});

export const identityPlatformLinkSchema = defineResource<CatalogIdentityPlatformLink>({
  type: 'identity-platform-links',
  id: (link) => String(link.id),
  attributes: {
    url: (link) => link.url,
    createdAt: (link) => link.createdAt.toISOString(),
    updatedAt: (link) => link.updatedAt.toISOString(),
  },
  relationships: { platform: { schema: () => PLATFORMS.schema, get: (link) => link.platform } },
});

/** A relationship of the entry's relations, which a withdrawn entry leaves out like its content. */
const related =
  (read: (relations: IdentityRelations) => unknown) =>
  ({ relations }: IdentityEntry): unknown =>
    relations === null ? undefined : read(relations);

const partialDate = (year: number | null, month: number | null, day: number | null) =>
  year === null ? null : { year, month, day };

const isWithdrawn = ({ identity }: IdentityEntry) => identity.editorialEntity!.publicationStatus === 'withdrawn';

/** An attribute of the entry's content, which a withdrawn entry leaves out: it only shows the notice. */
const content =
  (read: (entry: IdentityEntry) => unknown) =>
  (entry: IdentityEntry): unknown =>
    isWithdrawn(entry) ? undefined : read(entry);

export const identitySchema: ResourceSchema<IdentityEntry> = defineResource({
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
        birthCountryId: person.birthCountryId,
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
  relationships: {
    aliases: { schema: () => identityAliasSchema, get: related(({ aliases }) => aliases) },
    nationalities: { schema: () => COUNTRIES.schema, get: related(({ nationalities }) => nationalities) },
    birthCountry: { schema: () => COUNTRIES.schema, get: related(({ birthCountry }) => birthCountry) },
    originCountry: { schema: () => COUNTRIES.schema, get: related(({ originCountry }) => originCountry) },
    organizationTypes: { schema: () => ORGANIZATION_TYPES.schema, get: related(({ organizationTypes }) => organizationTypes) },
    platformLinks: { schema: () => identityPlatformLinkSchema, get: related(({ platformLinks }) => platformLinks) },
    artist: { schema: () => artistSchema, get: related(({ artist }) => artist) },
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

  @ApiProperty({ type: Number, nullable: true, description: 'id del país de nacimiento en /v1/countries' })
  birthCountryId: number | null;

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

class ToOneLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

class ToManyLinkage {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}

class IdentityRelationships {
  @ApiProperty({ type: ToManyLinkage, description: '`identity-aliases`, por `sortOrder`' })
  aliases: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`countries` de las nacionalidades documentadas; vacía en una organización' })
  nationalities: ToManyLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`countries`: país de nacimiento de una persona; null en una organización' })
  birthCountry: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`countries`: país de origen de una organización; null en una persona' })
  originCountry: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`organization-types`; vacía en una persona' })
  organizationTypes: ToManyLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`identity-platform-links`, cada uno con su `platform`' })
  platformLinks: ToManyLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`artists`: perfil artístico de la identidad, o null' })
  artist: ToOneLinkage;
}

export class IdentityResource {
  @ApiProperty({ enum: ['identities'] })
  type: string;

  @ApiProperty({ description: 'public_id de la identidad' })
  id: string;

  @ApiProperty({ type: IdentityAttributes })
  attributes: IdentityAttributes;

  @ApiProperty({ type: IdentityRelationships, required: false, description: WITHDRAWN })
  relationships?: IdentityRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}
