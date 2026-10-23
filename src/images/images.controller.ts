import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { ReceivesImage, UploadedImage } from './image-file';
import { ImageUploadResource, imageUploadSchema } from './image-upload.resource';
import { ImageUploadsService } from './image-uploads.service';

const UPLOAD_QUERY = resourceQuery(imageUploadSchema, { include: ['uploadedBy'] });

@ApiTags('images')
@Controller('images')
export class ImagesController {
  constructor(private readonly uploads: ImageUploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('verified')
  @ReceivesImage()
  @ApiOperation({
    summary: 'Subir una imagen de catálogo',
    description:
      'Recibe la imagen como `multipart/form-data` en el campo `file` y devuelve su URL pública, para ponerla en un borrador; ' +
      'no la asocia a ningún borrador. El tipo se detecta por el contenido (JPEG, PNG o WebP), con un máximo de 3 MB y de ' +
      '4000 px por lado. Se aplica la orientación EXIF, se quitan los metadatos y se recomprime sin pérdida visible ' +
      'conservando el formato. Una cuenta `user` puede subir 4 cada 15 días; al excederlo responde 429 con ' +
      '`meta.availableAt`, la fecha en que vuelve a haber cupo. El personal no tiene cupo. Un rechazo no consume cupo.',
  })
  @ApiJsonApiQuery(UPLOAD_QUERY)
  @ApiJsonApiResourceResponse(ImageUploadResource, 201)
  @ApiJsonApiErrorResponses(400, 406, 413, 415, 422, 429)
  async upload(
    @CurrentAuthentication() { user }: Authentication,
    @UploadedImage() image: Buffer,
    @JsonApiQuery(UPLOAD_QUERY) query: ResourceQuery,
  ) {
    const upload = await this.uploads.upload(user, 'catalog', image);
    return resourceDocument(imageUploadSchema, upload, query);
  }
}
