import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { ResourceIdentifier } from '../common/json-api/swagger';
import { USERNAME_CHANGE_INTERVAL_MS } from './account-rules';
import { USER_ROLES, USER_STATUSES, User } from './entities/user.entity';

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

/** An account as administrators see it, email included (P5). A deleted account has no email left. */
export const adminAccountSchema = defineResource<User>({
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
    lastLoginAt: (user) => user.lastLoginAt?.toISOString() ?? null,
    usernameChangedAt: (user) => user.usernameChangedAt.toISOString(),
  },
});

class AdminAccountAttributes {
  @ApiProperty({ example: 'diego_papi' })
  username: string;

  @ApiProperty({ type: String, nullable: true, example: 'diego@example.com', description: 'null en una cuenta eliminada' })
  email: string | null;

  @ApiProperty({ example: 'Diego' })
  displayName: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({ enum: USER_ROLES })
  role: string;

  @ApiProperty({ enum: USER_STATUSES })
  status: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt: string | null;

  @ApiProperty({ format: 'date-time' })
  usernameChangedAt: string;
}

export class AdminAccountResource {
  @ApiProperty({ enum: ['users'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: AdminAccountAttributes })
  attributes: AdminAccountAttributes;
}

/**
 * An account as anyone sees it: never its email or other private data. A deleted
 * account shows only its reserved username and its status.
 */
export const publicAccountSchema = defineResource<User>({
  type: 'users',
  id: (user) => user.uuid,
  attributes: {
    username: (user) => user.username,
    displayName: (user) => unlessDeleted(user, user.displayName),
    avatarUrl: (user) => unlessDeleted(user, user.avatarUrl),
    bio: (user) => unlessDeleted(user, user.bio),
    role: (user) => unlessDeleted(user, user.role),
    status: (user) => user.status,
    createdAt: (user) => unlessDeleted(user, user.createdAt.toISOString()),
  },
});

function unlessDeleted<T>(user: User, value: T): T | null {
  return user.status === 'deleted' ? null : value;
}

class PublicAccountAttributes {
  @ApiProperty({ example: 'diego_papi' })
  username: string;

  @ApiProperty({ type: String, nullable: true, example: 'Diego', description: 'null en una cuenta eliminada' })
  displayName: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty({ enum: USER_ROLES, nullable: true, description: 'null en una cuenta eliminada' })
  role: string | null;

  @ApiProperty({ enum: USER_STATUSES, description: '`suspended` indica una suspensión vigente' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Fecha de registro; null en una cuenta eliminada' })
  createdAt: string | null;
}

export class PublicAccountResource {
  @ApiProperty({ enum: ['users'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: PublicAccountAttributes })
  attributes: PublicAccountAttributes;
}

/** Only the identity of an account, for linkage from administrative resources. */
export const accountIdentitySchema = defineResource<User>({ type: 'users', id: (user) => user.uuid, attributes: {} });

export class AccountLinkage {
  @ApiProperty({ type: ResourceIdentifier })
  data: ResourceIdentifier;
}
