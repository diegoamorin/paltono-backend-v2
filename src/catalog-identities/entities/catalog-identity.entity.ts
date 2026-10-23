import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { EditorialEntity } from '../../editorial/entities/editorial-entity.entity';
import { Country } from '../../vocabularies/entities/country.entity';

export const CATALOG_IDENTITY_TYPES = ['person', 'organization'] as const;
export type CatalogIdentityType = (typeof CATALOG_IDENTITY_TYPES)[number];
export const PERSON_GENDERS = ['male', 'female', 'other'] as const;
export type PersonGender = (typeof PERSON_GENDERS)[number];

/*
 * The identity editorial root's domain rows. Only an applied creation inserts
 * them: a reservation has no row here.
 */

// Mirrors the CreateEditorialContributions migration, so `migration:generate` finds no drift.
@Entity('catalog_identities')
@Unique('catalog_identities_uuid_key', ['uuid'])
@Unique('catalog_identities_public_id_key', ['publicId'])
@Unique('catalog_identities_editorial_entity_id_key', ['editorialEntityId'])
@Check('catalog_identities_display_name_nonblank', `btrim(display_name) <> ''`)
@Check('catalog_identities_img_profile_format', `img_profile IS NULL OR img_profile ~* '^https?://[^\\s]+$'`)
export class CatalogIdentity {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'uuid' })
  uuid: string;

  @Column({ name: 'public_id', type: 'varchar', length: 21 })
  publicId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ type: 'enum', enum: CATALOG_IDENTITY_TYPES, enumName: 'catalog_identity_type' })
  type: CatalogIdentityType;

  @Column({ name: 'img_profile', type: 'varchar', length: 2048, nullable: true })
  imgProfile: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'editorial_entity_id', type: 'uuid' })
  editorialEntityId: string;

  @ManyToOne(() => EditorialEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'editorial_entity_id', foreignKeyConstraintName: 'catalog_identities_editorial_entity_id_fkey' })
  editorialEntity?: EditorialEntity;
}

@Entity('people')
@Index('people_birth_country_id_idx', ['birthCountryId'])
@Check('people_height_cm_range', `height_cm BETWEEN 1 AND 300`)
@Check('people_lifespan', `death_date >= birth_date`)
export class Person {
  @PrimaryColumn({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'people_catalog_identity_id_fkey' })
  catalogIdentity?: CatalogIdentity;

  @Column({ name: 'given_name', type: 'varchar', length: 200, nullable: true })
  givenName: string | null;

  @Column({ name: 'family_name', type: 'varchar', length: 200, nullable: true })
  familyName: string | null;

  /** Complete dates only, as `YYYY-MM-DD`; unknown is null. */
  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  /** The present-day country of the birthplace, independent of the nationalities. */
  @Column({ name: 'birth_country_id', type: 'integer', nullable: true })
  birthCountryId: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'birth_country_id', foreignKeyConstraintName: 'people_birth_country_id_fkey' })
  birthCountry?: Country | null;

  @Column({ name: 'death_date', type: 'date', nullable: true })
  deathDate: string | null;

  @Column({ name: 'height_cm', type: 'smallint', nullable: true })
  heightCm: number | null;

  @Column({ type: 'enum', enum: PERSON_GENDERS, enumName: 'person_gender', nullable: true })
  gender: PersonGender | null;
}

export const partialDateCheck = (prefix: string) =>
  `(${prefix}_year IS NULL OR ${prefix}_year BETWEEN 1 AND 9999) AND (${prefix}_month IS NULL OR (${prefix}_year IS NOT NULL AND ${prefix}_month BETWEEN 1 AND 12)) AND (${prefix}_day IS NULL OR (${prefix}_month IS NOT NULL AND ${prefix}_day BETWEEN 1 AND extract(day FROM make_date(${prefix}_year, ${prefix}_month, 1) + interval '1 month - 1 day')))`;

@Entity('organizations')
@Index('organizations_origin_country_id_idx', ['originCountryId'])
@Check('organizations_founding_date', partialDateCheck('founding'))
@Check('organizations_dissolution_date', partialDateCheck('dissolution'))
export class Organization {
  @PrimaryColumn({ name: 'catalog_identity_id', type: 'integer' })
  catalogIdentityId: number;

  @ManyToOne(() => CatalogIdentity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_identity_id', foreignKeyConstraintName: 'organizations_catalog_identity_id_fkey' })
  catalogIdentity?: CatalogIdentity;

  @Column({ name: 'legal_name', type: 'varchar', length: 200, nullable: true })
  legalName: string | null;

  @Column({ name: 'founding_year', type: 'smallint', nullable: true })
  foundingYear: number | null;

  @Column({ name: 'founding_month', type: 'smallint', nullable: true })
  foundingMonth: number | null;

  @Column({ name: 'founding_day', type: 'smallint', nullable: true })
  foundingDay: number | null;

  @Column({ name: 'dissolution_year', type: 'smallint', nullable: true })
  dissolutionYear: number | null;

  @Column({ name: 'dissolution_month', type: 'smallint', nullable: true })
  dissolutionMonth: number | null;

  @Column({ name: 'dissolution_day', type: 'smallint', nullable: true })
  dissolutionDay: number | null;

  @Column({ name: 'origin_country_id', type: 'integer', nullable: true })
  originCountryId: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'origin_country_id', foreignKeyConstraintName: 'organizations_origin_country_id_fkey' })
  originCountry?: Country | null;
}
