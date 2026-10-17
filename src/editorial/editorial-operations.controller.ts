import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { collectionDocument, pageWindow } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { OperationResource, operationSchema } from './editorial-operation.resource';
import { OPERATIONS } from './operation-registry';

const OPERATIONS_QUERY = collectionQuery(operationSchema, { sort: [], defaultSort: 'id' });

@ApiTags('editorial')
@Controller('editorial-operations')
export class EditorialOperationsController {
  @Get()
  @ApiOperation({
    summary: 'Registro de operaciones editoriales',
    description:
      'Por tipo de raíz: operaciones, selector `targetPath`, forma de `targetKey` y JSON Schema del payload por versión. ' +
      'Un microcambio solo puede usar una entrada de este registro.',
  })
  @ApiJsonApiQuery(OPERATIONS_QUERY)
  @ApiJsonApiCollectionResponse(OperationResource)
  @ApiJsonApiErrorResponses(400, 406)
  list(@JsonApiQuery(OPERATIONS_QUERY) query: CollectionQuery) {
    const { skip, take } = pageWindow(query);
    return collectionDocument(operationSchema, OPERATIONS.slice(skip, skip + take), OPERATIONS.length, query);
  }
}
