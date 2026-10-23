import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { CatalogImageUrls } from './catalog-image-urls';
import { ImageUpload } from './entities/image-upload.entity';
import { ImageStorageModule } from './image-storage.module';
import { ImageUploadsService } from './image-uploads.service';
import { ImagesController } from './images.controller';

/**
 * Image uploads (ADR 0005): upload, validation, processing, storage and quota,
 * for the catalog and for avatars. Other modules upload through
 * `ImageUploadsService`, remove files through `ImageStorage` or
 * `UploadedImageFiles`, and check the image URL rule through
 * `CatalogImageUrls`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ImageUpload]), AccountsModule, ImageStorageModule],
  controllers: [ImagesController, AvatarsController],
  providers: [ImageUploadsService, AvatarsService, CatalogImageUrls],
  exports: [ImageUploadsService, ImageStorageModule, CatalogImageUrls],
})
export class ImagesModule {}
