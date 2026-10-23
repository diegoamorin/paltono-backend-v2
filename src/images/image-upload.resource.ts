import { ApiProperty } from '@nestjs/swagger';
import { AccountLinkage, publicAccountSchema } from '../accounts/account.resource';
import { defineResource } from '../common/json-api/resource-schema';
import { IMAGE_UPLOAD_PURPOSES, ImageUpload } from './entities/image-upload.entity';

/** An image upload, loaded with its uploader. */
export const imageUploadSchema = defineResource<ImageUpload>({
  type: 'image-uploads',
  id: (upload) => upload.id,
  attributes: {
    purpose: (upload) => upload.purpose,
    url: (upload) => upload.url,
    bytes: (upload) => upload.bytes,
    createdAt: (upload) => upload.createdAt.toISOString(),
  },
  relationships: {
    uploadedBy: { schema: () => publicAccountSchema, get: (upload) => upload.uploadedBy },
  },
});

class ImageUploadAttributes {
  @ApiProperty({ enum: IMAGE_UPLOAD_PURPOSES })
  purpose: string;

  @ApiProperty({ format: 'uri', description: 'URL pública de la imagen, para usarla en un borrador' })
  url: string;

  @ApiProperty({ description: 'Peso de la imagen guardada, después de procesarla' })
  bytes: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

class ImageUploadRelationships {
  @ApiProperty({ type: AccountLinkage, description: 'Cuenta que subió la imagen' })
  uploadedBy: AccountLinkage;
}

export class ImageUploadResource {
  @ApiProperty({ enum: ['image-uploads'] })
  type: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: ImageUploadAttributes })
  attributes: ImageUploadAttributes;

  @ApiProperty({ type: ImageUploadRelationships })
  relationships: ImageUploadRelationships;
}
