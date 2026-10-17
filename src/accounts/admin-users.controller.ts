import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { collectionDocument, resourceDocument } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, ResourceQuery, collectionQuery, resourceQuery } from '../common/json-api/query';
import {
  ApiJsonApiCollectionResponse,
  ApiJsonApiErrorResponses,
  ApiJsonApiQuery,
  ApiJsonApiResourceResponse,
} from '../common/json-api/swagger';
import { AdminAccountResource, adminAccountSchema } from './account.resource';
import { AdminUsersService } from './admin-users.service';
import { accountId } from './administration';
import { Authenticated } from './authenticated.decorator';

const ACCOUNT_QUERY = resourceQuery(adminAccountSchema);
const ACCOUNTS_QUERY = collectionQuery(adminAccountSchema, {
  sort: ['createdAt', 'username', 'lastLoginAt'],
  defaultSort: '-createdAt',
  filters: ['q', 'role', 'status', 'emailVerified'],
});

@ApiTags('accounts')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @Authenticated('admin')
  @ApiOperation({
    summary: 'Listar cuentas',
    description:
      'Incluye el correo. `filter[q]` busca en username, correo y nombre visible; `filter[role]`, `filter[status]` y ' +
      '`filter[emailVerified]` (`true` o `false`) filtran por valor exacto. Las cuentas sin inicio de sesión van al final ' +
      'al ordenar por `lastLoginAt`.',
  })
  @ApiJsonApiQuery(ACCOUNTS_QUERY)
  @ApiJsonApiCollectionResponse(AdminAccountResource)
  @ApiJsonApiErrorResponses(400, 406)
  async list(@JsonApiQuery(ACCOUNTS_QUERY) query: CollectionQuery) {
    const { users, total } = await this.users.list(query);
    return collectionDocument(adminAccountSchema, users, total, query);
  }

  @Get(':id')
  @Authenticated('admin')
  @ApiOperation({ summary: 'Ver una cuenta', description: 'Detalle administrativo, con el correo.' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiJsonApiQuery(ACCOUNT_QUERY)
  @ApiJsonApiResourceResponse(AdminAccountResource)
  @ApiJsonApiErrorResponses(400, 404, 406)
  async show(@Param('id') id: string, @JsonApiQuery(ACCOUNT_QUERY) query: ResourceQuery) {
    return resourceDocument(adminAccountSchema, await this.users.show(accountId(id)), query);
  }
}
