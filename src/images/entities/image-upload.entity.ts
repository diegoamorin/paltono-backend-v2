import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { User } from '../../accounts/entities/user.entity';

export const IMAGE_UPLOAD_PURPOSES = ['catalog', 'avatar', 'platform_icon'] as const;
export type ImageUploadPurpose = (typeof IMAGE_UPLOAD_PURPOSES)[number];

// Mirrors the CreateImageUploads and AddImageUploadDimensionsAndFileRemoval migrations, so `migration:generate` finds no drift.
@Entity('image_uploads')
@Unique('image_uploads_url_key', ['url'])
@Check('image_uploads_url_format', `url ~ '^https?://'`)
@Check('image_uploads_bytes_positive', `bytes > 0`)
@Check('image_uploads_dimensions_positive', `width > 0 AND height > 0`)
@Index('image_uploads_uploaded_by_purpose_created_at_idx', ['uploadedById', 'purpose', 'createdAt'])
export class ImageUpload {
  /** Random and unguessable: it is also the name of the stored file. */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'uploaded_by', type: 'integer' })
  uploadedById: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by', foreignKeyConstraintName: 'image_uploads_uploaded_by_fkey' })
  uploadedBy: User;

  @Column({ type: 'enum', enum: IMAGE_UPLOAD_PURPOSES, enumName: 'image_upload_purpose' })
  purpose: ImageUploadPurpose;

  /** The public URL at upload time: the configured base plus the storage key. */
  @Column({ type: 'varchar', length: 2048 })
  url: string;

  /** Size of the stored file, after processing. */
  @Column({ type: 'integer' })
  bytes: number;

  /** Dimensions of the stored image, in pixels, once its EXIF orientation is applied. */
  @Column({ type: 'integer' })
  width: number;

  @Column({ type: 'integer' })
  height: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * When the file was removed from storage, or null while it is stored. The
   * upload stays as the account's history, but its URL is no longer served,
   * accepted nor shown.
   */
  @Column({ name: 'file_removed_at', type: 'timestamptz', nullable: true })
  fileRemovedAt: Date | null;
}
