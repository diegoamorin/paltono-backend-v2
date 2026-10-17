import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiJsonApiBody, ApiJsonApiErrorResponses } from '../common/json-api/swagger';
import { DEFAULT_FRONTEND } from '../config/app-config';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { EmailVerificationDocument, EmailVerificationRequestDocument } from './dto/email-verification.dto';
import { RateLimited } from './rate-limited.decorator';
import { RegistrationService } from './registration.service';
import { Authentication } from './sessions.service';

@ApiTags('accounts')
@Controller()
export class EmailVerificationsController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('email-verifications')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirmar el correo', description: 'Marca el correo como verificado y consume el token.' })
  @ApiJsonApiBody(EmailVerificationDocument)
  @ApiNoContentResponse({ description: 'Correo verificado' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422)
  async verify(@Body() body: EmailVerificationDocument): Promise<void> {
    await this.registration.verifyEmail(body.data.attributes.token);
  }

  @Post('email-verification-requests')
  @RateLimited()
  @HttpCode(HttpStatus.ACCEPTED)
  @Authenticated()
  @ApiOperation({
    summary: 'Reenviar el correo de verificación',
    description: 'Responde 202 aunque el envío falle; se puede volver a pedir.',
  })
  @ApiJsonApiBody(EmailVerificationRequestDocument)
  @ApiAcceptedResponse({ description: 'Envío solicitado' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422, 429)
  async requestVerification(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: EmailVerificationRequestDocument,
  ): Promise<void> {
    await this.registration.requestVerification(user, body.data.attributes?.frontend ?? DEFAULT_FRONTEND);
  }
}
