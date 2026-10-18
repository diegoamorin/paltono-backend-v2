import { ApiProperty } from '@nestjs/swagger';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { AFFILIATION_RELATIONSHIP_TYPES, ASSOCIATION_STATUSES, Artist, ArtistOrganizationAffiliation } from './entities/artist.entity';
import { IdentityEntry, identitySchema } from './identity.resource';

/** An affiliation with the organization it names, which may show only its withdrawal notice. */
export interface AffiliationEntry {
  affiliation: ArtistOrganizationAffiliation;
  organization: IdentityEntry;
}

/**
 * An artist profile with its identity. Its affiliations are loaded when the
 * request serves them; a profile of a withdrawn identity shows only the notice.
 */
export interface ArtistEntry {
  artist: Artist;
  identity: IdentityEntry;
  affiliations?: AffiliationEntry[];
}

const isWithdrawn = ({ identity }: ArtistEntry) => identity.identity.editorialEntity!.publicationStatus === 'withdrawn';

export const affiliationSchema: ResourceSchema<AffiliationEntry> = defineResource({
  type: 'artist-affiliations',
  id: ({ affiliation }) => String(affiliation.id),
  attributes: {
    relationshipType: ({ affiliation }) => affiliation.relationshipType,
    startedAt: ({ affiliation }) => affiliation.startedAt,
    endedAt: ({ affiliation }) => affiliation.endedAt,
    status: ({ affiliation }) => affiliation.status,
    description: ({ affiliation }) => affiliation.description,
    createdAt: ({ affiliation }) => affiliation.createdAt.toISOString(),
    updatedAt: ({ affiliation }) => affiliation.updatedAt.toISOString(),
  },
  relationships: { organization: { schema: () => identitySchema, get: ({ organization }) => organization } },
});

export const artistSchema: ResourceSchema<ArtistEntry> = defineResource({
  type: 'artists',
  id: ({ artist }) => artist.publicId,
  attributes: {
    publicationStatus: ({ identity }) => identity.identity.editorialEntity!.publicationStatus,
    withdrawnAt: ({ identity }) => identity.identity.editorialEntity!.withdrawnAt?.toISOString() ?? null,
    createdAt: (entry) => (isWithdrawn(entry) ? undefined : entry.artist.createdAt.toISOString()),
    updatedAt: (entry) => (isWithdrawn(entry) ? undefined : entry.artist.updatedAt.toISOString()),
  },
  relationships: {
    identity: { schema: () => identitySchema, get: ({ identity }) => identity },
    affiliations: { schema: () => affiliationSchema, get: (entry) => (isWithdrawn(entry) ? undefined : entry.affiliations) },
  },
  meta: ({ identity }) => ({ editorialEntityId: identity.identity.editorialEntityId }),
});

const WITHDRAWN = 'Ausente si la identidad está retirada';

class ArtistAttributes {
  @ApiProperty({ enum: ['published', 'withdrawn'], description: 'Estado de la identidad del perfil; retirada, solo muestra el aviso' })
  publicationStatus: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt: string | null;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  createdAt?: string;

  @ApiProperty({ format: 'date-time', required: false, description: WITHDRAWN })
  updatedAt?: string;
}

class ToOneLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

class ToManyLinkage {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}

class ArtistRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`identities`: la identidad del perfil, con su nombre visible, imagen y biografía' })
  identity: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, required: false, description: `\`artist-affiliations\`. ${WITHDRAWN}` })
  affiliations?: ToManyLinkage;
}

class EntryMeta {
  @ApiProperty({ format: 'uuid', description: 'UUID editorial de la identidad, raíz a la que pertenece el perfil' })
  editorialEntityId: string;
}

export class ArtistResource {
  @ApiProperty({ enum: ['artists'] })
  type: string;

  @ApiProperty({ description: 'public_id del perfil artístico' })
  id: string;

  @ApiProperty({ type: ArtistAttributes })
  attributes: ArtistAttributes;

  @ApiProperty({ type: ArtistRelationships })
  relationships: ArtistRelationships;

  @ApiProperty({ type: EntryMeta })
  meta: EntryMeta;
}

class AffiliationAttributes {
  @ApiProperty({ enum: AFFILIATION_RELATIONSHIP_TYPES })
  relationshipType: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  startedAt: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  endedAt: string | null;

  @ApiProperty({ enum: ASSOCIATION_STATUSES })
  status: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

class AffiliationRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`identities`: la agencia, el sello o el management; si está retirada, solo su aviso' })
  organization: ToOneLinkage;
}

export class AffiliationResource {
  @ApiProperty({ enum: ['artist-affiliations'] })
  type: string;

  @ApiProperty()
  id: string;

  @ApiProperty({ type: AffiliationAttributes })
  attributes: AffiliationAttributes;

  @ApiProperty({ type: AffiliationRelationships })
  relationships: AffiliationRelationships;
}
