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
import { RoleChangeDocument } from './dto/role-change.dto';
import { RoleChangeResource, roleChangeSchema } from './role-change.resource';
import { RoleChangesService } from './role-changes.service';
import { Authentication } from './sessions.service';

const ROLE_CHANGE_QUERY = resourceQuery(roleChangeSchema);
const ROLE_CHANGES_QUERY = collectionQuery(roleChangeSchema, { sort: ['changedAt'], defaultSort: '-changedAt' });

@ApiTags('accounts')
@Controller('admin/users/:id/role-changes')
export class RoleChangesController {
  constructor(private readonly roleChanges: RoleChangesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authenticated('admin')
  @ApiOperation({
    summary: 'Cambiar el rol de una cuenta',
    description:
      'Compara con el rol vigente bajo bloqueo y lo audita. No se puede degradar al último administrador activo y verificado.',
  })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(ROLE_CHANGE_QUERY)
  @ApiJsonApiBody(RoleChangeDocument)
  @ApiJsonApiResourceResponse(RoleChangeResource, 201)
  @ApiJsonApiErrorResponses(400, 404, 406, 409, 415, 422)
  async change(
    @CurrentAuthentication() { user }: Authentication,
    @Param('id') id: string,
    @Body() body: RoleChangeDocument,
    @JsonApiQuery(ROLE_CHANGE_QUERY) query: ResourceQuery,
  ) {
    const { newRole, reason } = body.data.attributes;
    const change = await this.roleChanges.change(user, accountId(id), newRole, reason);
    // There is no route for a single change; the audit of the account is where it can be read back.
    return resourceDocument(roleChangeSchema, change, query);
  }

  @Get()
  @Authenticated('admin')
  @ApiOperation({ summary: 'Auditoría de roles de una cuenta', description: 'Incluye la promoción inicial por consola.' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(ROLE_CHANGES_QUERY)
  @ApiJsonApiCollectionResponse(RoleChangeResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async list(@Param('id') id: string, @JsonApiQuery(ROLE_CHANGES_QUERY) query: CollectionQuery) {
    const { changes, total } = await this.roleChanges.list(accountId(id), query);
    return collectionDocument(roleChangeSchema, changes, total, query);
  }
}
