import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiJsonApiBody, ApiJsonApiErrorResponses } from '../common/json-api/swagger';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { AccountDeletionDocument } from './dto/account-deletion.dto';
import { clearRefreshTokenCookie } from './sessions.controller';
import { Authentication } from './sessions.service';
import { StatusChangesService } from './status-changes.service';

@ApiTags('accounts')
@Controller('account-deletions')
export class AccountDeletionsController {
  constructor(private readonly statusChanges: StatusChangesService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated('verified')
  @ApiOperation({
    summary: 'Darse de baja',
    description:
      'Exige la contraseña. Borra el correo, que queda libre, el avatar, la biografía y la contraseña; el username queda ' +
      'reservado y pasa a ser el nombre visible. Revoca todas las sesiones, invalida los tokens pendientes, borra la ' +
      'cookie de renovación y queda auditada con la propia cuenta como autora. El último administrador activo y ' +
      'verificado no puede darse de baja.',
  })
  @ApiJsonApiBody(AccountDeletionDocument)
  @ApiNoContentResponse({ description: 'Cuenta dada de baja' })
  @ApiJsonApiErrorResponses(406, 409, 415, 422)
  async delete(
    @CurrentAuthentication() { user }: Authentication,
    @Body() body: AccountDeletionDocument,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.statusChanges.deleteOwn(user, body.data.attributes.password);
    clearRefreshTokenCookie(response);
  }
}
