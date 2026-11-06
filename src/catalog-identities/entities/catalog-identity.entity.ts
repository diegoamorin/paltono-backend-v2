import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { birthDateCheck, partialDateCheck } from '../../common/partial-date/partial-date';
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
@Check('people_birth_date', birthDateCheck)
@Check('people_death_date', partialDateCheck('death'))
@Check('people_img_full_body_format', `img_full_body IS NULL OR img_full_body ~* '^https?://[^\\s]+$'`)
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

  /** A partial date, or a birthday: its month and day with a null year. */
  @Column({ name: 'birth_year', type: 'smallint', nullable: true })
  birthYear: number | null;

  @Column({ name: 'birth_month', type: 'smallint', nullable: true })
  birthMonth: number | null;

  @Column({ name: 'birth_day', type: 'smallint', nullable: true })
  birthDay: number | null;

  /** The present-day country of the birthplace, independent of the nationalities. */
  @Column({ name: 'birth_country_id', type: 'integer', nullable: true })
  birthCountryId: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'birth_country_id', foreignKeyConstraintName: 'people_birth_country_id_fkey' })
  birthCountry?: Country | null;

  @Column({ name: 'death_year', type: 'smallint', nullable: true })
  deathYear: number | null;

  @Column({ name: 'death_month', type: 'smallint', nullable: true })
  deathMonth: number | null;

  @Column({ name: 'death_day', type: 'smallint', nullable: true })
  deathDay: number | null;

  @Column({ name: 'height_cm', type: 'smallint', nullable: true })
  heightCm: number | null;

  @Column({ type: 'enum', enum: PERSON_GENDERS, enumName: 'person_gender', nullable: true })
  gender: PersonGender | null;

  /** A standing image from head to feet, which an app scales with the height; independent of it. */
  @Column({ name: 'img_full_body', type: 'varchar', length: 2048, nullable: true })
  imgFullBody: string | null;
}

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
