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
import { MAX_IMAGE_BYTES, imageTooLarge } from './image-processing';

/** The multipart field that carries the image. */
export const IMAGE_FIELD = 'file';

/** Reads one file of at most the upload limit into memory, without touching the disk. */
const readImageFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }).single(
  IMAGE_FIELD,
);

@Injectable()
class ImageFileInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) =>
      readImageFile(http.getRequest<Request>(), http.getResponse<Response>(), (error: unknown) =>
        error ? reject(toJsonApiError(error)) : resolve(),
      ),
    );
    return next.handle();
  }
}

function toJsonApiError(error: unknown): unknown {
  if (!(error instanceof MulterError)) return error;
  if (error.code === 'LIMIT_FILE_SIZE') return imageTooLarge();
  return new JsonApiException(HttpStatus.BAD_REQUEST, [
    { code: 'invalid_image_upload', detail: `Send one image in the multipart field "${IMAGE_FIELD}"` },
  ]);
}

/**
 * Receives the endpoint's body as `multipart/form-data` with one image in the
 * `file` field, documented as such. The route must also be listed in
 * `MULTIPART_PATHS`, so the JSON:API media type check lets its body through.
 */
export function ReceivesImage() {
  return applyDecorators(
    UseInterceptors(ImageFileInterceptor),
    ApiConsumes(MULTIPART_MEDIA_TYPE),
    ApiBody({
      schema: {
        type: 'object',
        required: [IMAGE_FIELD],
        properties: {
          [IMAGE_FIELD]: {
            type: 'string',
            format: 'binary',
            description: `JPEG, PNG o WebP, detectado por su contenido; como máximo ${MAX_IMAGE_BYTES / 1024 / 1024} MB y 4000 px por lado`,
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
