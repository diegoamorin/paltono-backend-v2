import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { AccountLinkage, accountIdentitySchema } from './account.resource';
import { UserStatusChange } from './entities/user-status-change.entity';
import { USER_STATUSES } from './entities/user.entity';

/** An audited status change, loaded with its affected account and the account that made it. */
export const statusChangeSchema = defineResource<UserStatusChange>({
  type: 'status-changes',
  id: (change) => change.id,
  attributes: {
    previousStatus: (change) => change.previousStatus,
    newStatus: (change) => change.newStatus,
    reason: (change) => change.reason,
    changedAt: (change) => change.changedAt.toISOString(),
  },
  relationships: {
    user: { schema: () => accountIdentitySchema, get: (change) => change.user },
    changedBy: { schema: () => accountIdentitySchema, get: (change) => change.changedBy },
  },
});

class StatusChangeAttributes {
  @ApiProperty({ enum: USER_STATUSES })
  previousStatus: string;

  @ApiProperty({ enum: USER_STATUSES })
  newStatus: string;

  @ApiProperty({ type: String, nullable: true, description: 'null solo en una baja voluntaria' })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  changedAt: string;
}

class StatusChangeRelationships {
  @ApiProperty({ type: AccountLinkage })
  user: AccountLinkage;

  @ApiProperty({ type: AccountLinkage, description: 'El administrador, o la propia cuenta en una baja voluntaria' })
  changedBy: AccountLinkage;
}

export class StatusChangeResource {
  @ApiProperty({ enum: ['status-changes'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: StatusChangeAttributes })
  attributes: StatusChangeAttributes;

  @ApiProperty({ type: StatusChangeRelationships })
  relationships: StatusChangeRelationships;
}
