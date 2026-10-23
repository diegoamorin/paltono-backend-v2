import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ImageStorage, LocalImageStorage, UploadedImageFiles } from './image-storage';

/**
 * The storage of uploaded images, apart from the upload endpoints so the
 * accounts module can remove an avatar's file without depending on them.
 */
@Module({
  providers: [
    {
      provide: ImageStorage,
      inject: [APP_CONFIG],
      useFactory: ({ images }: AppConfig): ImageStorage => new LocalImageStorage(images.storage.directory),
    },
    UploadedImageFiles,
  ],
  exports: [ImageStorage, UploadedImageFiles],
})
export class ImageStorageModule {}
