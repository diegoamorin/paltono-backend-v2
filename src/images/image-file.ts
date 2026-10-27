import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  UseInterceptors,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { Observable } from 'rxjs';
import { JsonApiException } from '../common/json-api/json-api.exception';
import { MULTIPART_MEDIA_TYPE } from '../common/json-api/media-type';
import { MAX_IMAGE_BYTES, imageTooLarge, svgIconTooLarge } from './image-processing';
import { MAX_SVG_ICON_BYTES } from './svg-icons';

/** The multipart field that carries the image. */
export const IMAGE_FIELD = 'file';

/** What an endpoint accepts in its file: how much it may weigh, the error past that, and how it is documented. */
export interface ImageFileKind {
  maxBytes: number;
  tooLarge: () => JsonApiException;
  description: string;
}

/** The JPEG, PNG or WebP of catalog uploads and avatars. */
export const RASTER_IMAGE: ImageFileKind = {
  maxBytes: MAX_IMAGE_BYTES,
  tooLarge: imageTooLarge,
  description: `JPEG, PNG o WebP, detectado por su contenido; como máximo ${MAX_IMAGE_BYTES / 1024 / 1024} MB y 4000 px por lado`,
};

/** The SVG of a platform icon. */
export const SVG_ICON: ImageFileKind = {
  maxBytes: MAX_SVG_ICON_BYTES,
  tooLarge: svgIconTooLarge,
  description: `SVG con viewBox; como máximo ${MAX_SVG_ICON_BYTES / 1024} KB`,
};

@Injectable()
class ImageFileInterceptor implements NestInterceptor {
  /** Reads one file of at most the kind's limit into memory, without touching the disk. */
  private readonly read: ReturnType<multer.Multer['single']>;

  constructor(private readonly kind: ImageFileKind) {
    this.read = multer({ storage: multer.memoryStorage(), limits: { fileSize: kind.maxBytes, files: 1 } }).single(IMAGE_FIELD);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) =>
      this.read(http.getRequest<Request>(), http.getResponse<Response>(), (error: unknown) =>
        error ? reject(this.toJsonApiError(error)) : resolve(),
      ),
    );
    return next.handle();
  }

  private toJsonApiError(error: unknown): unknown {
    if (!(error instanceof MulterError)) return error;
    if (error.code === 'LIMIT_FILE_SIZE') return this.kind.tooLarge();
    return new JsonApiException(HttpStatus.BAD_REQUEST, [
      { code: 'invalid_image_upload', detail: `Send one image in the multipart field "${IMAGE_FIELD}"` },
    ]);
  }
}

/**
 * Receives the endpoint's body as `multipart/form-data` with one file of
 * `kind` in the `file` field, documented as such. The route must also be
 * listed in `MULTIPART_PATHS`, so the JSON:API media type check lets its body
 * through.
 */
export function ReceivesImage(kind: ImageFileKind = RASTER_IMAGE) {
  const { description } = kind;
  return applyDecorators(
    UseInterceptors(new ImageFileInterceptor(kind)),
    ApiConsumes(MULTIPART_MEDIA_TYPE),
    ApiBody({
      schema: {
        type: 'object',
        required: [IMAGE_FIELD],
        properties: {
          [IMAGE_FIELD]: {
            type: 'string',
            format: 'binary',
            description,
          },
        },
      },
    }),
  );
}

/** The bytes of the image of a `@ReceivesImage()` endpoint; a request without one answers 400. */
export const UploadedImage = createParamDecorator((_: unknown, context: ExecutionContext): Buffer => {
  const file = context.switchToHttp().getRequest<Request>().file;
  if (!file) {
    throw new JsonApiException(HttpStatus.BAD_REQUEST, [
      { code: 'image_required', detail: `Send the image as multipart/form-data in the field "${IMAGE_FIELD}"` },
    ]);
  }
  return file.buffer;
});
