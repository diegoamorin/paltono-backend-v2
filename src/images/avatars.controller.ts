import { Controller, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OwnAccountResource, ownAccountSchema } from '../accounts/account.resource';
import { Authenticated, CurrentAuthentication } from '../accounts/authenticated.decorator';
import { Authentication } from '../accounts/sessions.service';
import { resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { ResourceQuery, resourceQuery } from '../common/json-api/query';
import { ApiJsonApiErrorResponses, ApiJsonApiQuery, ApiJsonApiResourceResponse } from '../common/json-api/swagger';
import { AvatarsService } from './avatars.service';
import { ReceivesImage, UploadedImage } from './image-file';

const ME_QUERY = resourceQuery(ownAccountSchema);

@ApiTags('accounts')
@Controller('me/avatar')
export class AvatarsController {
  constructor(private readonly avatars: AvatarsService) {}

  @Put()
  @Authenticated('verified')
  @ReceivesImage()
  @ApiOperation({
    summary: 'Subir el avatar propio',
    description:
      'Recibe la imagen como `multipart/form-data` en el campo `file`, con la misma validación y procesamiento que ' +
      '`POST /v1/images`, y la pone de inmediato como `avatarUrl` de la cuenta, sin revisión editorial. El avatar ' +
      'anterior se borra del almacenamiento. Cada cuenta, de cualquier rol, puede cambiar su avatar una vez cada 15 ' +
      'días, aparte del cupo de catálogo; al excederlo responde 429 con `meta.availableAt`, la fecha en que vuelve a ' +
      'haber cupo. Un rechazo no consume cupo. Devuelve la cuenta propia.',
  })
  @ApiJsonApiQuery(ME_QUERY)
  @ApiJsonApiResourceResponse(OwnAccountResource)
  @ApiJsonApiErrorResponses(400, 406, 413, 415, 422, 429)
  async replace(
    @CurrentAuthentication() { user }: Authentication,
    @UploadedImage() image: Buffer,
    @JsonApiQuery(ME_QUERY) query: ResourceQuery,
  ) {
    return resourceDocument(ownAccountSchema, await this.avatars.replace(user, image), query);
  }
}
