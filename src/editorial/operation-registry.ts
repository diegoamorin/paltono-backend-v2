import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import { EntityManager } from 'typeorm';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { ChangeOperation, ValueEnvelope } from './entities/proposal-change.entity';
import { IDENTITY_CREATION } from './identity-creation';

/*
 * The registry of operations a microchange may carry (E1). A microchange names
 * an entry by its root's type, operation, `target_path` and payload schema
 * version; nothing outside this list reaches the domain tables, so no selector
 * ever stands for SQL or an arbitrary table.
 */

/** A problem with a payload, at a JSON Pointer path inside the proposed envelope. */
export interface PayloadProblem {
  path: string;
  detail: string;
}

/** A vocabulary entry a payload refers to, which must exist. */
export interface VocabularyReference {
  vocabulary: 'countries';
  id: number;
  path: string;
}

/** What applying an operation wrote, for its revision. */
export interface AppliedOperation {
  /** The value the target holds afterwards, as the domain rows store it. */
  afterValue: ValueEnvelope;
  /** The key of the row the operation generated, if any. */
  resultKey: object | null;
}

export interface OperationDefinition {
  entityType: EditorialEntityType;
  operation: ChangeOperation;
  targetPath: string;
  payloadSchemaVersion: number;
  description: string;
  /** JSON Schema of the envelope's `value`. */
  valueSchema: object;
  /** Rules beyond the JSON Schema, run once the value matches it. */
  check(value: unknown): PayloadProblem[];
  references(value: unknown): VocabularyReference[];
  /** The value the operation's target holds now, as the base a decision observes. */
  read(manager: EntityManager, root: EditorialEntity): Promise<ValueEnvelope>;
  /** Writes a valid proposed value to the domain tables, inside the transaction of the decision that applies it. */
  apply(manager: EntityManager, root: EditorialEntity, value: unknown, now: Date): Promise<AppliedOperation>;
}

export const OPERATIONS: readonly OperationDefinition[] = [IDENTITY_CREATION];

/** Creations start from absence, so their base is always the empty envelope. */
export const ABSENT: ValueEnvelope = { exists: false };

/** The published JSON Schema of the proposed envelope of an operation. */
export function payloadSchema(definition: OperationDefinition): object {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['exists', 'value'],
    properties: { exists: { const: true }, value: definition.valueSchema },
  };
}

export function operationId(definition: OperationDefinition): string {
  return `${definition.entityType}.${definition.operation}.${definition.targetPath}.v${definition.payloadSchemaVersion}`;
}

export function findOperation(
  entityType: EditorialEntityType,
  operation: string,
  targetPath: string,
  payloadSchemaVersion: number,
): OperationDefinition | undefined {
  return OPERATIONS.find(
    (each) =>
      each.entityType === entityType &&
      each.operation === operation &&
      each.targetPath === targetPath &&
      each.payloadSchemaVersion === payloadSchemaVersion,
  );
}

/** Whether any registry entry matches the given part of a selector. */
export function isRegistered(selector: { entityType?: string; operation?: string; targetPath?: string }): boolean {
  return OPERATIONS.some((each) =>
    Object.entries(selector).every(([member, value]) => each[member as keyof typeof selector] === value),
  );
}

/** The entity types a reservation can be made for: those with a registered creation. */
export function creatableEntityTypes(): EditorialEntityType[] {
  return OPERATIONS.filter(({ operation }) => operation === 'create_entity').map(({ entityType }) => entityType);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
const validators = new Map<OperationDefinition, ValidateFunction>(
  OPERATIONS.map((definition) => [definition, ajv.compile(payloadSchema(definition))]),
);

/** Validates a proposed envelope against the published schema, then against the operation's own rules. */
export function validatePayload(definition: OperationDefinition, proposed: unknown): PayloadProblem[] {
  const validate = validators.get(definition)!;
  if (!validate(proposed)) return validate.errors!.map(toProblem);
  return definition.check((proposed as { value: unknown }).value);
}

function toProblem(error: ErrorObject): PayloadProblem {
  if (error.keyword === 'required') {
    return { path: `${error.instancePath}/${error.params.missingProperty}`, detail: 'is required' };
  }
  if (error.keyword === 'additionalProperties') {
    return { path: `${error.instancePath}/${error.params.additionalProperty}`, detail: 'is not allowed' };
  }
  if (error.keyword === 'false schema') return { path: error.instancePath, detail: 'is not allowed here' };
  return { path: error.instancePath, detail: error.message ?? 'is invalid' };
}
