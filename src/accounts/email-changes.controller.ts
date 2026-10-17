import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiJsonApiBody, ApiJsonApiErrorResponses } from '../common/json-api/swagger';
import { DEFAULT_FRONTEND } from '../config/app-config';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { EmailChangeDocument, EmailChangeRequestDocument } from './dto/email-change.dto';
import { EmailChangesService } from './email-changes.service';
import { RateLimited } from './rate-limited.decorator';
import { Authentication } from './sessions.service';

@ApiTags('accounts')
@Controller()
export class EmailChangesController {
  constructor(private readonly emailChanges: EmailChangesService) {}

  @Post('me/email-change-requests')
  @RateLimited()
  @HttpCode(HttpStatus.ACCEPTED)
  @Authenticated()
  @ApiOperation({
    summary: 'Pedir el cambio de correo',
    description:
      'Exige la contraseña actual, también a cuentas sin verificar. Envía al correo nuevo un enlace de un solo uso, válido ' +
      'EMAIL_CHANGE_TTL_MINUTES (30 por defecto), y anula las solicitudes anteriores. El correo actual se conserva hasta ' +
      'confirmar. Responde 202 aunque el envío falle; se puede volver a pedir.',
  })
  @ApiJsonApiBody(EmailChangeRequestDocument)
  @ApiAcceptedResponse({ description: 'Envío solicitado' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422, 429)
  async request(@CurrentAuthentication() { user }: Authentication, @Body() body: EmailChangeRequestDocument): Promise<void> {
    const { currentPassword, newEmail, frontend = DEFAULT_FRONTEND } = body.data.attributes;
    await this.emailChanges.request(user, currentPassword, newEmail, frontend);
  }

  @Post('email-changes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirmar el cambio de correo',
    description:
      'Sustituye el correo por el del token, verificado, y consume el token. Revalida bajo bloqueo que nadie use ese ' +
      'correo e invalida los demás tokens pendientes de la cuenta, incluidos los enlaces enviados al correo anterior.',
  })
  @ApiJsonApiBody(EmailChangeDocument)
  @ApiNoContentResponse({ description: 'Correo cambiado' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422)
  async confirm(@Body() body: EmailChangeDocument): Promise<void> {
    await this.emailChanges.confirm(body.data.attributes.token);
  }
}
