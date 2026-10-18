import { Check, Column, Entity, ForeignKey, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ContributionRole, ContributionRoleScope } from '../../vocabularies/entities/contribution-role.entity';
import { CatalogIdentity, Organization, partialDateCheck } from './catalog-identity.entity';

export const ASSOCIATION_STATUSES = ['current', 'former', 'unknown'] as const;
export type AssociationStatus = (typeof ASSOCIATION_STATUSES)[number];
export const AFFILIATION_RELATIONSHIP_TYPES = ['agency', 'label', 'management'] as const;
export type AffiliationRelationshipType = (typeof AFFILIATION_RELATIONSHIP_TYPES)[number];

/*
 * The artist profile of an identity, organization memberships and artist
 * affiliations: components of the identity root, which only applied relation
 * changes write.
 */

// Mirrors the CreateArtistsAndMemberships migration, so `migration:generate` finds no drift.
/** The optional artist profile of an identity: a component of its root, not a root of its own. */
@Entity('artists')
@Unique('artists_uuid_key', ['uuid'])
@Unique('artists_public_id_key', ['publicId'])
@Unique('artists_catalog_identity_id_key', ['catalogIdentityId'])
export class Artist {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'artists_catalog_identity_id_fkey' })
  identity?: CatalogIdentity;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** A musical membership of an identity in an organization, owned by the organization's root. */
@Entity('organization_memberships')
// UNIQUE NULLS NOT DISTINCT in the migration, which TypeORM cannot declare.
@Unique('organization_memberships_period_key', ['organizationId', 'memberIdentityId', 'joinedYear', 'joinedMonth', 'joinedDay'])
@Index('organization_memberships_member_identity_id_idx', ['memberIdentityId'])
@Check('organization_memberships_not_self', `organization_id <> member_identity_id`)
@Check('organization_memberships_joined_date', partialDateCheck('joined'))
@Check('organization_memberships_left_date', partialDateCheck('left'))
@Check('organization_memberships_status', `(left_year IS NULL OR status = 'former') AND (status <> 'current' OR left_year IS NULL)`)
@Check('organization_memberships_source_url_format', `source_url IS NULL OR source_url ~* '^https?://[^\\s]+$'`)
export class OrganizationMembership {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'organization_id', type: 'integer' })
  organizationId: number;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'organization_memberships_organization_id_fkey' })
  organization?: Organization;

  @Column({ name: 'member_identity_id', type: 'integer' })
  memberIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'member_identity_id', foreignKeyConstraintName: 'organization_memberships_member_identity_id_fkey' })
  member?: CatalogIdentity;

  @Column({ name: 'joined_year', type: 'smallint', nullable: true })
  joinedYear: number | null;

  @Column({ name: 'joined_month', type: 'smallint', nullable: true })
  joinedMonth: number | null;

  @Column({ name: 'joined_day', type: 'smallint', nullable: true })
  joinedDay: number | null;

  @Column({ name: 'left_year', type: 'smallint', nullable: true })
  leftYear: number | null;

  @Column({ name: 'left_month', type: 'smallint', nullable: true })
  leftMonth: number | null;

  @Column({ name: 'left_day', type: 'smallint', nullable: true })
  leftDay: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: ASSOCIATION_STATUSES, enumName: 'association_status', default: 'unknown' })
  status: AssociationStatus;

  @Column({ name: 'source_text', type: 'text', nullable: true })
  sourceText: string | null;

  @Column({ name: 'source_url', type: 'varchar', length: 2048, nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** A musical role of a member within a membership, from the roles with the `membership` scope. */
@Entity('organization_membership_roles')
@Unique('organization_membership_roles_membership_role_key', ['organizationMembershipId', 'contributionRoleId'])
@Index('organization_membership_roles_contribution_role_id_idx', ['contributionRoleId', 'roleScope'])
@ForeignKey(() => ContributionRoleScope, ['contribution_role_id', 'role_scope'], ['contribution_role_id', 'scope'], {
  name: 'organization_membership_roles_role_fkey',
  onDelete: 'RESTRICT',
})
@Check('organization_membership_roles_role_scope', `role_scope = 'membership'`)
@Check('organization_membership_roles_position_nonnegative', `position >= 0`)
export class OrganizationMembershipRole {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'organization_membership_id', type: 'integer' })
  organizationMembershipId: number;

  @ManyToOne(() => OrganizationMembership, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_membership_id', foreignKeyConstraintName: 'organization_membership_roles_organization_membership_id_fkey' })
  membership?: OrganizationMembership;

  @Column({ name: 'contribution_role_id', type: 'integer' })
  contributionRoleId: number;

  /** Read through the (role, scope) foreign key; the relation only loads the role. */
  @ManyToOne(() => ContributionRole, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'contribution_role_id' })
  role?: ContributionRole;

  @Column({ name: 'role_scope', type: 'enum', enum: ['work', 'recording', 'release', 'membership'], enumName: 'contribution_role_scope', default: 'membership' })
  roleScope: 'membership';

  @Column({ type: 'smallint' })
  position: number;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** An informational association of an artist with an agency, a label or management, owned by the artist's root. */
@Entity('artist_organization_affiliations')
// UNIQUE NULLS NOT DISTINCT in the migration, which TypeORM cannot declare.
@Unique('artist_organization_affiliations_period_key', ['artistId', 'organizationId', 'relationshipType', 'startedAt'])
@Index('artist_organization_affiliations_organization_id_idx', ['organizationId'])
@Check('artist_organization_affiliations_interval', `ended_at >= started_at`)
@Check('artist_organization_affiliations_status', `(ended_at IS NULL OR status = 'former') AND (status <> 'current' OR ended_at IS NULL)`)
export class ArtistOrganizationAffiliation {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'artist_id', type: 'integer' })
  artistId: number;

  @ManyToOne(() => Artist, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'artist_id', foreignKeyConstraintName: 'artist_organization_affiliations_artist_id_fkey' })
  artist?: Artist;

  @Column({ name: 'organization_id', type: 'integer' })
  organizationId: number;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'artist_organization_affiliations_organization_id_fkey' })
  organization?: Organization;

  @Column({ name: 'relationship_type', type: 'enum', enum: AFFILIATION_RELATIONSHIP_TYPES, enumName: 'affiliation_relationship_type' })
  relationshipType: AffiliationRelationshipType;

  /** Complete dates only, as `YYYY-MM-DD`; unknown is null. */
  @Column({ name: 'started_at', type: 'date', nullable: true })
  startedAt: string | null;

  @Column({ name: 'ended_at', type: 'date', nullable: true })
  endedAt: string | null;

  @Column({ type: 'enum', enum: ASSOCIATION_STATUSES, enumName: 'association_status', default: 'unknown' })
  status: AssociationStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
