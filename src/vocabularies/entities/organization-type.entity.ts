import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Nonexclusive organization category, such as agency or label; it grants no permission. */
@Entity('organization_types')
@Unique('organization_types_slug_key', ['slug'])
@Check('organization_types_slug_format', `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('organization_types_name_nonblank', `btrim(name) <> ''`)
export class OrganizationType {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
