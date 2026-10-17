import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('genres')
@Unique('genres_slug_key', ['slug'])
@Check('genres_slug_format', `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('genres_name_nonblank', `btrim(name) <> ''`)
export class Genre {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;
}
