import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { USERNAME_CHANGE_INTERVAL_MS } from './account-rules';
import { User } from './entities/user.entity';

/** An account as its owner sees it, with private fields such as the email. */
export const ownAccountSchema = defineResource<User>({
  type: 'users',
  id: (user) => user.uuid,
  attributes: {
    username: (user) => user.username,
    email: (user) => user.email,
    displayName: (user) => user.displayName,
    avatarUrl: (user) => user.avatarUrl,
    bio: (user) => user.bio,
    emailVerified: (user) => user.emailVerified,
    role: (user) => user.role,
    status: (user) => user.status,
    createdAt: (user) => user.createdAt.toISOString(),
    usernameChangedAt: (user) => user.usernameChangedAt.toISOString(),
    usernameChangeAvailableAt: (user) =>
      new Date(user.usernameChangedAt.getTime() + USERNAME_CHANGE_INTERVAL_MS).toISOString(),
  },
});

class OwnAccountAttributes {
  @ApiProperty({ example: 'diego_papi' })
  username: string;

  @ApiProperty({ example: 'diego@example.com' })
  email: string;

  @ApiProperty({ example: 'Diego' })
  displayName: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({ enum: ['user', 'moderator', 'admin'] })
  role: string;

  @ApiProperty({ enum: ['active', 'suspended', 'deleted'] })
  status: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  usernameChangedAt: string;

  @ApiProperty({ format: 'date-time', description: 'Primer instante en que se puede volver a cambiar el username' })
  usernameChangeAvailableAt: string;
}

export class OwnAccountResource {
  @ApiProperty({ enum: ['users'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: OwnAccountAttributes })
  attributes: OwnAccountAttributes;
}
