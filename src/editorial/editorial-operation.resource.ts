import { ApiProperty } from '@nestjs/swagger';
import { defineResource } from '../common/json-api/resource-schema';
import { EDITORIAL_ENTITY_TYPES } from './entities/editorial-entity.entity';
import { CHANGE_OPERATIONS } from './entities/proposal-change.entity';
import { ABSENT, OperationDefinition, operationId, payloadSchema } from './operation-registry';

/** An entry of the registry of operations, with the JSON Schema its payloads must match. */
export const operationSchema = defineResource<OperationDefinition>({
  type: 'editorial-operations',
  id: operationId,
  attributes: {
    entityType: (definition) => definition.entityType,
    operation: (definition) => definition.operation,
    targetPath: (definition) => definition.targetPath,
    targetKey: (definition) => definition.targetKeySchema,
    payloadSchemaVersion: (definition) => definition.payloadSchemaVersion,
    // A creation starts from absence; any other operation from its target's value when the microchange is added.
    baseValue: (definition) => (definition.operation === 'create_entity' ? ABSENT : null),
    payloadSchema,
    description: (definition) => definition.description,
  },
});

class OperationAttributes {
  @ApiProperty({ enum: EDITORIAL_ENTITY_TYPES })
  entityType: string;

  @ApiProperty({ enum: CHANGE_OPERATIONS })
  operation: string;

  @ApiProperty({ example: 'catalog_identities', description: 'Selector permitido; nunca una tabla arbitraria ni SQL' })
  targetPath: string;

  @ApiProperty({ type: Object, nullable: true, description: 'JSON Schema de `targetKey`; null si la operación no selecciona filas' })
  targetKey: object | null;

  @ApiProperty({ example: 1 })
  payloadSchemaVersion: number;

  @ApiProperty({
    type: Object,
    nullable: true,
    example: { exists: false },
    description:
      'Base que fija el servidor: una alta parte de ausencia; null cuando la base es el valor vigente del objetivo al añadir el microcambio',
  })
  baseValue: object | null;

  @ApiProperty({ type: Object, description: 'JSON Schema (2020-12) de `proposedValue`' })
  payloadSchema: object;

  @ApiProperty()
  description: string;
}

export class OperationResource {
  @ApiProperty({ enum: ['editorial-operations'] })
  type: string;

  @ApiProperty({ example: 'identity.create_entity.catalog_identities.v1' })
  id: string;

  @ApiProperty({ type: OperationAttributes })
  attributes: OperationAttributes;
}
