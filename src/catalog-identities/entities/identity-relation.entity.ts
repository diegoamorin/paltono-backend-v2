import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Country } from '../../vocabularies/entities/country.entity';
import { CatalogIdentity, Person } from './catalog-identity.entity';

/*
 * Dependent rows the identity editorial root owns. Only applied relation
 * changes write them.
 */

// Mirrors the CreateIdentityRelations migration, so `migration:generate` finds no drift.
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
