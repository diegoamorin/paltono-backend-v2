import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuthentication } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { ReceivesImage, SVG_ICON, UploadedImage } from './image-file';
import { ImageUploadResource, imageUploadSchema } from './image-upload.resource';
import { ImageUploadsService } from './image-uploads.service';
import { MAX_SVG_ICON_BYTES, MAX_SVG_VIOLATIONS } from './svg-icons';

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

  @Post('platform-icons')
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('admin')
  @ReceivesImage(SVG_ICON)
  @ApiOperation({
    summary: 'Subir el icono de una plataforma externa',
    description:
      'Recibe un SVG como `multipart/form-data` en el campo `file` y devuelve su URL pública, para ponerla como `iconUrl` ' +
      'de una plataforma externa. Es el único endpoint que acepta SVG. Solo admite una lista blanca de elementos ' +
      '(`svg`, `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `defs`, `linearGradient`, ' +
      '`radialGradient`, `stop`, `clipPath`, `mask`, `use`, `title`) y de atributos de geometría y presentación, ' +
      '`role` y `aria-*`; `href` y `url()` solo como `#id`. Un `viewBox` es obligatorio y da `width` y `height`. ' +
      'Se descartan comentarios, `<metadata>` y la marca de los editores; cualquier otra cosa se rechaza con 422, ' +
      'un error por elemento o atributo a quitar (`svg_forbidden_element`, `svg_forbidden_attribute`, ' +
      `\`svg_external_reference\`, con su nombre en \`meta\`; como máximo ${MAX_SVG_VIOLATIONS}), o con \`svg_doctype_not_allowed\`, ` +
      `\`svg_missing_viewbox\` o \`svg_unparseable\`. Un SVG de más de ${MAX_SVG_ICON_BYTES / 1024} KB responde 413 \`svg_too_large\`. ` +
      'Se guarda el SVG reconstruido, no el original. Sin cupo. Muéstralo solo con `<img src>`.',
  })
  @ApiJsonApiQuery(UPLOAD_QUERY)
  @ApiJsonApiResourceResponse(ImageUploadResource, 201)
  @ApiJsonApiErrorResponses(400, 401, 403, 406, 413, 415, 422)
  async uploadPlatformIcon(
    @CurrentAuthentication() { user }: Authentication,
    @UploadedImage() icon: Buffer,
    @JsonApiQuery(UPLOAD_QUERY) query: ResourceQuery,
  ) {
    const upload = await this.uploads.upload(user, 'platform_icon', icon);
    return resourceDocument(imageUploadSchema, upload, query);
  }
}
