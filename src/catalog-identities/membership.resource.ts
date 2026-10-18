import { ApiProperty } from '@nestjs/swagger';
import { ResourceSchema, defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { CONTRIBUTION_ROLES } from '../vocabularies/contribution-roles';
import { ASSOCIATION_STATUSES, OrganizationMembership, OrganizationMembershipRole } from './entities/artist.entity';
import { IdentityEntry, identitySchema } from './identity.resource';

/** A membership with both identities, each of which may show only its withdrawal notice, and its roles with their vocabulary entries. */
export interface MembershipEntry {
  membership: OrganizationMembership;
  organization: IdentityEntry;
  member: IdentityEntry;
  roles: OrganizationMembershipRole[];
}

const partialDate = (year: number | null, month: number | null, day: number | null) => (year === null ? null : { year, month, day });

export const membershipRoleSchema = defineResource<OrganizationMembershipRole>({
  type: 'membership-roles',
  id: (role) => String(role.id),
  attributes: { position: (role) => role.position, details: (role) => role.details },
  relationships: { role: { schema: () => CONTRIBUTION_ROLES.schema, get: (role) => role.role } },
});

export const membershipSchema: ResourceSchema<MembershipEntry> = defineResource<MembershipEntry>({
  type: 'organization-memberships',
  id: ({ membership }) => String(membership.id),
  attributes: {
    joined: ({ membership }) => partialDate(membership.joinedYear, membership.joinedMonth, membership.joinedDay),
    left: ({ membership }) => partialDate(membership.leftYear, membership.leftMonth, membership.leftDay),
    status: ({ membership }) => membership.status,
    description: ({ membership }) => membership.description,
    sourceText: ({ membership }) => membership.sourceText,
    sourceUrl: ({ membership }) => membership.sourceUrl,
    createdAt: ({ membership }) => membership.createdAt.toISOString(),
    updatedAt: ({ membership }) => membership.updatedAt.toISOString(),
  },
  relationships: {
    organization: { schema: () => identitySchema, get: ({ organization }) => organization },
    member: { schema: () => identitySchema, get: ({ member }) => member },
    roles: { schema: () => membershipRoleSchema, get: ({ roles }) => roles },
  },
});

class PartialDate {
  @ApiProperty({ example: 2016 })
  year: number;

  @ApiProperty({ type: Number, nullable: true, example: 8 })
  month: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 8 })
  day: number | null;
}

class MembershipAttributes {
  @ApiProperty({ type: PartialDate, nullable: true, description: 'Fecha parcial de entrada; los nulos marcan la precisión desconocida' })
  joined: PartialDate | null;

  @ApiProperty({ type: PartialDate, nullable: true, description: 'Fecha parcial de salida' })
  left: PartialDate | null;

  @ApiProperty({ enum: ASSOCIATION_STATUSES })
  status: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceText: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceUrl: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

class ToOneLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true })
  data: ResourceIdentifier | null;
}

class ToManyLinkage {
  @ApiProperty({ type: [ResourceIdentifier] })
  data: ResourceIdentifier[];
}

class MembershipRelationships {
  @ApiProperty({ type: ToOneLinkage, description: '`identities`: la organización' })
  organization: ToOneLinkage;

  @ApiProperty({ type: ToOneLinkage, description: '`identities`: la persona u organización miembro; si está retirada, solo su aviso' })
  member: ToOneLinkage;

  @ApiProperty({ type: ToManyLinkage, description: '`membership-roles`, por posición, cada uno con su `role` de `contribution-roles`' })
  roles: ToManyLinkage;
}

export class MembershipResource {
  @ApiProperty({ enum: ['organization-memberships'] })
  type: string;

  @ApiProperty()
  id: string;

  @ApiProperty({ type: MembershipAttributes })
  attributes: MembershipAttributes;

  @ApiProperty({ type: MembershipRelationships })
  relationships: MembershipRelationships;
}
