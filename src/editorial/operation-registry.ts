import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import { EntityManager } from 'typeorm';
import { Country } from '../vocabularies/entities/country.entity';
import { OrganizationType } from '../vocabularies/entities/organization-type.entity';
import { Platform } from '../vocabularies/entities/platform.entity';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { ChangeOperation, ValueEnvelope } from './entities/proposal-change.entity';
import { withdrawalOf } from './entity-withdrawal';
import { IDENTITY_CREATION } from './identity-creation';
import { IDENTITY_FIELD_CHANGES } from './identity-field-changes';
import { IDENTITY_RELATION_CHANGES } from './identity-relation-changes';

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

/** The entity behind each vocabulary a payload or a target key may refer to. */
export const VOCABULARIES = { countries: Country, organization_types: OrganizationType, platforms: Platform } as const;

/** A vocabulary entry a payload or a target key refers to, which must exist. */
export interface VocabularyReference {
  vocabulary: keyof typeof VOCABULARIES;
  id: number;
  path: string;
}

/**
 * A problem with a valid payload on the root's current data. `member` names
 * what is wrong: `targetPath` or a path inside `proposedValue`.
 */
export interface TargetProblem {
  code: string;
  detail: string;
  member: string;
}

/**
 * The primary key of the dependent row a relation operation selects, with
 * every reference translated to the domain's keys; null for operations that
 * select no row.
 */
export type RowKey = Record<string, number>;

/** What applying an operation wrote, for its revision. */
export interface AppliedOperation {
  /** The value the target holds afterwards, as the domain rows store it. */
  afterValue: ValueEnvelope;
  /** The key of the row the operation generated or selected, if any. */
  resultKey: object | null;
}

export interface OperationDefinition {
  entityType: EditorialEntityType;
  operation: ChangeOperation;
  targetPath: string;
  payloadSchemaVersion: number;
  description: string;
  /** JSON Schema of the envelope's `value`; null when the operation proposes absence. */
  valueSchema: object | null;
  /**
   * JSON Schema of `targetKey`: the primary key of the dependent row the
   * operation selects. Null when it selects no row, as a root operation or an
   * insertion whose key the row will generate.
   */
  targetKeySchema: object | null;
  /** Rules beyond the JSON Schema, run once the value matches it. */
  check(value: unknown): PayloadProblem[];
  references(value: unknown): VocabularyReference[];
  /**
   * For an insertion whose row will generate its key, the unique key of a
   * valid value, which tells two insertions of the same row apart. Undefined
   * when the value has none.
   */
  naturalKey?(value: unknown): object | undefined;
  /** Vocabulary entries the target key refers to, with paths inside `targetKey`. */
  keyReferences?(targetKey: object): VocabularyReference[];
  /**
   * Rules on the root's current data, such as a field its subtype lacks or an
   * interval with a field the change leaves as it is. Run when the change is
   * added, submitted and applied, so they always see the latest data.
   */
  targetProblems?(manager: EntityManager, root: EditorialEntity, value: unknown): Promise<TargetProblem[]>;
  /**
   * The value the operation's target holds now, as the base a decision
   * observes. A relation reads the row its key selects or, for an insertion,
   * the row its proposed value would collide with by its unique key.
   */
  read(manager: EntityManager, root: EditorialEntity, key: RowKey | null, value: unknown): Promise<ValueEnvelope>;
  /**
   * What applying the value would break besides its own target, such as a
   * uniqueness among the root's other rows. Applying never overrides them,
   * not even over a confirmed new base.
   */
  constraintProblems?(manager: EntityManager, root: EditorialEntity, key: RowKey | null, value: unknown): Promise<string[]>;
  /** Writes a valid proposed value to the domain tables, inside the transaction of the decision that applies it. */
  apply(manager: EntityManager, root: EditorialEntity, value: unknown, now: Date, key: RowKey | null): Promise<AppliedOperation>;
}

export const OPERATIONS: readonly OperationDefinition[] = [
  IDENTITY_CREATION,
  ...IDENTITY_FIELD_CHANGES,
  ...IDENTITY_RELATION_CHANGES,
  withdrawalOf('identity'),
];

/** Creations start from absence, so their base is always the empty envelope. */
export const ABSENT: ValueEnvelope = { exists: false };

/** The published JSON Schema of the proposed envelope of an operation: a value, or absence for a removal. */
export function payloadSchema(definition: OperationDefinition): object {
  const envelope =
    definition.valueSchema === null
      ? { required: ['exists'], properties: { exists: { const: false } } }
      : { required: ['exists', 'value'], properties: { exists: { const: true }, value: definition.valueSchema } };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, ...envelope };
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
const keyValidators = new Map<OperationDefinition, ValidateFunction>(
  OPERATIONS.filter(({ targetKeySchema }) => targetKeySchema !== null).map((definition) => [definition, ajv.compile(definition.targetKeySchema!)]),
);

/** Validates a proposed envelope against the published schema, then against the operation's own rules. */
export function validatePayload(definition: OperationDefinition, proposed: unknown): PayloadProblem[] {
  const validate = validators.get(definition)!;
  if (!validate(proposed)) return validate.errors!.map(toProblem);
  return definition.check((proposed as { value: unknown }).value);
}

/** Validates a target key against the operation's schema; paths are inside `targetKey`. */
export function validateTargetKey(definition: OperationDefinition, targetKey: unknown): PayloadProblem[] {
  const validate = keyValidators.get(definition)!;
  return validate(targetKey) ? [] : validate.errors!.map(toProblem);
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
