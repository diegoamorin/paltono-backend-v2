import { Check, Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

export const CONTRIBUTION_ROLE_CATEGORIES = ['writing', 'arrangement', 'performance', 'production', 'engineering'] as const;
export type ContributionRoleCategory = (typeof CONTRIBUTION_ROLE_CATEGORIES)[number];

/** Where a role may be credited; credits reference a (role, scope) pair. */
export const CONTRIBUTION_ROLE_SCOPES = ['work', 'recording', 'release', 'membership'] as const;
export type ContributionRoleScopeName = (typeof CONTRIBUTION_ROLE_SCOPES)[number];

/** Shared vocabulary of musical functions, such as composer or mixing engineer. */
@Entity('contribution_roles')
@Unique('contribution_roles_slug_key', ['slug'])
@Check('contribution_roles_slug_format', `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('contribution_roles_name_nonblank', `btrim(name) <> ''`)
export class ContributionRole {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: CONTRIBUTION_ROLE_CATEGORIES, enumName: 'contribution_role_category' })
  category: ContributionRoleCategory;

  @OneToMany(() => ContributionRoleScope, (scope) => scope.contributionRole)
  allowedScopes?: ContributionRoleScope[];
}

@Entity('contribution_role_scopes')
export class ContributionRoleScope {
  @PrimaryColumn({ name: 'contribution_role_id', type: 'integer' })
  contributionRoleId: number;

  @PrimaryColumn({ type: 'enum', enum: CONTRIBUTION_ROLE_SCOPES, enumName: 'contribution_role_scope' })
  scope: ContributionRoleScopeName;

  @ManyToOne(() => ContributionRole, (role) => role.allowedScopes, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contribution_role_id', foreignKeyConstraintName: 'contribution_role_scopes_contribution_role_id_fkey' })
  contributionRole?: ContributionRole;
}
