import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ImageUpload } from './entities/image-upload.entity';
import { ImageStorage, LocalImageStorage } from './image-storage';
import { ImageUploadsService } from './image-uploads.service';
import { ImagesController } from './images.controller';

/**
 * Image uploads (ADR 0005): upload, validation, processing, storage and quota.
 * Other modules upload through `ImageUploadsService` and remove files through
 * `ImageStorage`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ImageUpload]), AccountsModule],
  controllers: [ImagesController],
  providers: [
    ImageUploadsService,
    {
      provide: ImageStorage,
      inject: [APP_CONFIG],
      useFactory: ({ images }: AppConfig): ImageStorage => new LocalImageStorage(images.storage.directory),
    },
  ],
  exports: [ImageUploadsService, ImageStorage],
})
export class ImagesModule {}
