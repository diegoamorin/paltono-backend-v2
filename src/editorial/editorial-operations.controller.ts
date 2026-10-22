import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { collectionDocument, pageWindow } from '../common/json-api/document';
import { JsonApiQuery } from '../common/json-api/json-api-query.decorator';
import { CollectionQuery, collectionQuery } from '../common/json-api/query';
import { ApiJsonApiCollectionResponse, ApiJsonApiErrorResponses, ApiJsonApiQuery } from '../common/json-api/swagger';
import { OperationResource, operationSchema } from './editorial-operation.resource';
import { registeredOperations } from './operation-registry';

const OPERATIONS_QUERY = collectionQuery(operationSchema, { sort: [], defaultSort: 'id' });

@ApiTags('editorial')
@Controller('editorial-operations')
export class EditorialOperationsController {
  @Get()
  @ApiOperation({
    summary: 'Registro de operaciones editoriales',
    description:
      'Por tipo de raíz: operaciones, selector `targetPath`, forma de `targetKey` y JSON Schema del payload por versión. ' +
      'Un microcambio solo puede usar la versión vigente (`status: current`) de una entrada de este registro; ' +
      'las versiones obsoletas se siguen listando para leer el historial.',
  })
  @ApiJsonApiQuery(OPERATIONS_QUERY)
  @ApiJsonApiCollectionResponse(OperationResource)
  @ApiJsonApiErrorResponses(400, 406)
  list(@JsonApiQuery(OPERATIONS_QUERY) query: CollectionQuery) {
    const { skip, take } = pageWindow(query);
    const operations = registeredOperations();
    return collectionDocument(operationSchema, operations.slice(skip, skip + take), operations.length, query);
  }
}
