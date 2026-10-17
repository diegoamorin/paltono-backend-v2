import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Shared country vocabulary for nationality, organization origin and event location. */
@Entity('countries')
@Unique('countries_code_key', ['code'])
@Check('countries_code_format', `code ~ '^[A-Z]{2}$'`)
@Check('countries_name_nonblank', `btrim(name) <> ''`)
export class Country {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  /** Uppercase two-letter code. */
  @Column({ type: 'char', length: 2 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;
}
