import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** A streaming or social platform; the `supports*` flags say which catalog links it can hold. */
@Entity('platforms')
@Unique('platforms_name_key', ['name'])
@Unique('platforms_slug_key', ['slug'])
@Unique('platforms_icon_url_key', ['iconUrl'])
@Check('platforms_slug_format', `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('platforms_name_nonblank', `btrim(name) <> ''`)
@Check('platforms_icon_url_format', `icon_url ~ '^https?://'`)
export class Platform {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ name: 'icon_url', type: 'varchar', length: 2048 })
  iconUrl: string;

  /** Identity pages, of persons or organizations, including artist profiles. */
  @Column({ name: 'supports_catalog_identity', type: 'boolean', default: false })
  supportsCatalogIdentity: boolean;

  @Column({ name: 'supports_track', type: 'boolean', default: false })
  supportsTrack: boolean;

  @Column({ name: 'supports_album', type: 'boolean', default: false })
  supportsAlbum: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
