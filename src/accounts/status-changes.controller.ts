import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiBody,
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { accountId } from './administration';
import { Authenticated, CurrentAuthentication } from './authenticated.decorator';
import { StatusChangeDocument } from './dto/status-change.dto';
import { Authentication } from './sessions.service';
import { StatusChangeResource, statusChangeSchema } from './status-change.resource';
import { StatusChangesService } from './status-changes.service';

const STATUS_CHANGE_QUERY = resourceQuery(statusChangeSchema);
const STATUS_CHANGES_QUERY = collectionQuery(statusChangeSchema, { sort: ['changedAt'], defaultSort: '-changedAt' });

@ApiTags('accounts')
@Controller('admin/users/:id/status-changes')
export class StatusChangesController {
  constructor(private readonly statusChanges: StatusChangesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('admin')
  @ApiOperation({
    summary: 'Suspender, reactivar o dar de baja una cuenta suspendida',
    description:
      'Compara con el estado vigente bajo bloqueo y lo audita. La suspensión revoca todas las sesiones y no caduca sola; ' +
      'solo una cuenta suspendida puede darse de baja así, a petición de su titular, y `deleted` es terminal. ' +
      'No se puede suspender ni dar de baja al último administrador activo y verificado.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(STATUS_CHANGE_QUERY)
  @ApiJsonApiBody(StatusChangeDocument)
  @ApiJsonApiResourceResponse(StatusChangeResource, 201)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async change(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: StatusChangeDocument,
    @JsonApiQuery(STATUS_CHANGE_QUERY) query: ResourceQuery,
  ) {
    const { newStatus, reason } = body.data.attributes;
    const change = await this.statusChanges.change(user, accountId(id), newStatus, reason);
    // There is no route for a single change; the audit of the account is where it can be read back.
    return resourceDocument(statusChangeSchema, change, query);
  }

  @Get()
  @Authenticated('admin')
  @ApiOperation({ summary: 'Auditoría de estados de una cuenta', description: 'Incluye las bajas voluntarias.' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(STATUS_CHANGES_QUERY)
  @ApiJsonApiCollectionResponse(StatusChangeResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(STATUS_CHANGES_QUERY) query: CollectionQuery) {
    const { changes, total } = await this.statusChanges.list(accountId(id), query);
    return collectionDocument(statusChangeSchema, changes, total, query);
  }
}
