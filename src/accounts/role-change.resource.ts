import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { AccountLinkage, accountIdentitySchema } from './account.resource';
import { UserRoleChange } from './entities/user-role-change.entity';
import { USER_ROLES } from './entities/user.entity';

/** An audited role change, loaded with its affected account and acting administrator. */
export const roleChangeSchema = defineResource<UserRoleChange>({
  type: 'role-changes',
  id: (change) => change.id,
  attributes: {
    previousRole: (change) => change.previousRole,
    newRole: (change) => change.newRole,
    reason: (change) => change.reason,
    changedAt: (change) => change.changedAt.toISOString(),
  },
  relationships: {
    user: { schema: () => accountIdentitySchema, get: (change) => change.user },
    changedBy: { schema: () => accountIdentitySchema, get: (change) => change.changedBy },
  },
});

class RoleChangeAttributes {
  @ApiProperty({ enum: USER_ROLES })
  previousRole: string;

  @ApiProperty({ enum: USER_ROLES })
  newRole: string;

  @ApiProperty({ type: String, nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  changedAt: string;
}

class ActingAdministratorLinkage {
  @ApiProperty({ type: ResourceIdentifier, nullable: true, description: 'null en la promoción inicial por consola' })
  data: ResourceIdentifier | null;
}

class RoleChangeRelationships {
  @ApiProperty({ type: AccountLinkage })
  user: AccountLinkage;

  @ApiProperty({ type: ActingAdministratorLinkage })
  changedBy: ActingAdministratorLinkage;
}

export class RoleChangeResource {
  @ApiProperty({ enum: ['role-changes'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: RoleChangeAttributes })
  attributes: RoleChangeAttributes;

  @ApiProperty({ type: RoleChangeRelationships })
  relationships: RoleChangeRelationships;
}
