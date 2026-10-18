import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Country } from '../../vocabularies/entities/country.entity';
import { OrganizationType } from '../../vocabularies/entities/organization-type.entity';
import { Platform } from '../../vocabularies/entities/platform.entity';
import { CatalogIdentity, Organization, Person } from './catalog-identity.entity';

/*
 * Dependent rows the identity editorial root owns. Only applied relation
 * changes write them.
 */

// Mirrors the CreateIdentityRelations and CreateIdentityLinks migrations, so `migration:generate` finds no drift.
@Entity('catalog_identity_aliases')
@Unique('catalog_identity_aliases_catalog_identity_id_alias_key', ['catalogIdentityId', 'alias'])
@Index('catalog_identity_aliases_primary_key', ['catalogIdentityId'], { unique: true, where: 'is_primary' })
@Check('catalog_identity_aliases_alias_nonblank', `btrim(alias) <> ''`)
@Check('catalog_identity_aliases_sort_order_nonnegative', `sort_order >= 0`)
export class CatalogIdentityAlias {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'catalog_identity_aliases_catalog_identity_id_fkey' })
  catalogIdentity?: CatalogIdentity;

  @Column({ type: 'varchar', length: 200 })
  alias: string;

  /** At most one alias of an identity is its primary one. */
  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;
}

/** A documented nationality of a person; none when unknown. */
@Entity('person_nationalities')
@Index('person_nationalities_country_id_idx', ['countryId'])
export class PersonNationality {
  @PrimaryColumn({ name: 'person_id', type: 'integer', primaryKeyConstraintName: 'person_nationalities_pkey' })
  personId: number;

  @ManyToOne(() => Person, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'person_id', foreignKeyConstraintName: 'person_nationalities_person_id_fkey' })
  person?: Person;

  @PrimaryColumn({ name: 'country_id', type: 'integer', primaryKeyConstraintName: 'person_nationalities_pkey' })
  countryId: number;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'country_id', foreignKeyConstraintName: 'person_nationalities_country_id_fkey' })
  country?: Country;
}

/** A category of an organization, such as agency or label; an organization may have several. */
@Entity('organization_type_assignments')
@Index('organization_type_assignments_organization_type_id_idx', ['organizationTypeId'])
export class OrganizationTypeAssignment {
  @PrimaryColumn({ name: 'organization_id', type: 'integer', primaryKeyConstraintName: 'organization_type_assignments_pkey' })
  organizationId: number;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'organization_type_assignments_organization_id_fkey' })
  organization?: Organization;

  @PrimaryColumn({ name: 'organization_type_id', type: 'integer', primaryKeyConstraintName: 'organization_type_assignments_pkey' })
  organizationTypeId: number;

  @ManyToOne(() => OrganizationType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_type_id', foreignKeyConstraintName: 'organization_type_assignments_organization_type_id_fkey' })
  organizationType?: OrganizationType;
}

/** A link of an identity on a platform that supports identities. */
@Entity('catalog_identity_platform_links')
@Unique('catalog_identity_platform_links_identity_platform_url_key', ['catalogIdentityId', 'platformId', 'url'])
@Index('catalog_identity_platform_links_platform_id_idx', ['platformId'])
@Check('catalog_identity_platform_links_url_format', `url ~* '^https?://[^\\s]+$'`)
@Check('catalog_identity_platform_links_play_count_nonnegative', `play_count >= 0`)
export class CatalogIdentityPlatformLink {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ name: 'platform_id', type: 'integer' })
  platformId: number;

  @ManyToOne(() => Platform, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'platform_id', foreignKeyConstraintName: 'catalog_identity_platform_links_platform_id_fkey' })
  platform?: Platform;

  @Column({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'catalog_identity_platform_links_catalog_identity_id_fkey' })
  catalogIdentity?: CatalogIdentity;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Deferred beyond the MVP: always NULL, and no write sets it. */
  @Column({ name: 'play_count', type: 'bigint', nullable: true, select: false })
  playCount?: string | null;
}
