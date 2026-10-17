import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiJsonApiBody, ApiJsonApiErrorResponses } from '../common/json-api/swagger';
import { DEFAULT_FRONTEND } from '../config/app-config';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { PasswordChangeDocument, PasswordResetDocument, PasswordResetRequestDocument } from './dto/password.dto';
import { PasswordsService } from './passwords.service';
import { RateLimited } from './rate-limited.decorator';
import { clearRefreshTokenCookie } from './sessions.controller';
import { Authentication } from './sessions.service';

@ApiTags('accounts')
@Controller()
export class PasswordsController {
  constructor(private readonly passwords: PasswordsService) {}

  @Post('password-reset-requests')
  @RateLimited()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Pedir la recuperación de la contraseña',
    description: 'Envía un enlace de un solo uso, válido PASSWORD_RESET_TTL_MINUTES (30 por defecto). Responde 202 idéntico exista o no la cuenta.',
  })
  @ApiJsonApiBody(PasswordResetRequestDocument)
  @ApiAcceptedResponse({ description: 'Solicitud recibida' })
  @ApiJsonApiErrorResponses(406, 415, 422, 429)
  async requestReset(@Body() body: PasswordResetRequestDocument): Promise<void> {
    const { email, frontend = DEFAULT_FRONTEND } = body.data.attributes;
    await this.passwords.requestReset(email, frontend);
  }

  @Post('password-resets')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Completar la recuperación de la contraseña',
    description: 'Fija la contraseña, consume el token, marca el correo como verificado y revoca todas las sesiones.',
  })
  @ApiJsonApiBody(PasswordResetDocument)
  @ApiNoContentResponse({ description: 'Contraseña restablecida' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422)
  async reset(@Body() body: PasswordResetDocument): Promise<void> {
    const { token, password } = body.data.attributes;
    await this.passwords.resetPassword(token, password);
  }

  @Post('me/password-changes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @ApiOperation({
    summary: 'Cambiar la contraseña',
    description: 'Exige la contraseña actual. Revoca todas las sesiones, la actual incluida, y borra la cookie de renovación.',
  })
  @ApiJsonApiBody(PasswordChangeDocument)
  @ApiNoContentResponse({ description: 'Contraseña cambiada' })
  @ApiJsonApiErrorResponses(406, 415, 422)
  async change(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: PasswordChangeDocument,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { currentPassword, newPassword } = body.data.attributes;
    await this.passwords.changePassword(user, currentPassword, newPassword);
    clearRefreshTokenCookie(response);
  }
}
