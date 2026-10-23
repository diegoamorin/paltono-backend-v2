import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import { EntityManager } from 'typeorm';
import { ImageUrlReference } from '../images/catalog-image-urls';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { Country } from '../vocabularies/entities/country.entity';
import { Genre } from '../vocabularies/entities/genre.entity';
import { OrganizationType } from '../vocabularies/entities/organization-type.entity';
import { Platform } from '../vocabularies/entities/platform.entity';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { ChangeOperation, ValueEnvelope } from './entities/proposal-change.entity';
import { ARTIST_CHANGES } from './artist-changes';
import { MEMBERSHIP_CHANGES } from './membership-changes';
import { withdrawalOf } from './entity-withdrawal';
import { IDENTITY_CREATION } from './identity-creation';
import { IDENTITY_FIELD_CHANGES } from './identity-field-changes';
import { IDENTITY_RELATION_CHANGES } from './identity-relation-changes';
import { EVENT_CHANGES, TOUR_CHANGES } from './live-event-changes';
import { RECORDING_CHANGES } from './recording-changes';
import { RELEASE_CHANGES, RELEASE_GROUP_CHANGES } from './release-changes';
import { WORK_CHANGES } from './work-changes';

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
export const VOCABULARIES = {
  countries: Country,
  organization_types: OrganizationType,
  platforms: Platform,
  genres: Genre,
  contribution_roles: ContributionRole,
} as const;

/** A vocabulary entry a payload or a target key refers to, which must exist. */
export interface VocabularyReference {
  vocabulary: keyof typeof VOCABULARIES;
  id: number;
  path: string;
}

/**
 * A root a payload names, `{"entity_id": …}`, at a JSON Pointer path inside
 * the proposed envelope or, `within` the target key, inside `targetKey`.
 */
export interface RootReference {
  entityId: string;
  entityType: EditorialEntityType;
  path: string;
  within?: 'proposedValue' | 'targetKey';
}

/** A member of a target key that names another root than the microchange's, by its editorial UUID. */
export interface KeyRoot {
  entityType: EditorialEntityType;
  /** The domain id the member stands for in the row's key, or null while there is none. */
  idOf(manager: EntityManager, editorialEntityId: string): Promise<number | null>;
}

/**
 * A member of a target key that names a row of another relation of the same
 * root, such as the track of a track credit: by its id, or by the insertion of
 * the same proposal that creates it, `{"change_id": …}`.
 */
export interface KeyRow {
  /** The relation whose insertion may stand for the row. */
  targetPath: string;
  /** The member of that insertion's result key that holds the row's id. */
  resultMember: string;
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
  /** Image URLs a valid value proposes, each of which must be a catalog upload (ADR 0005). */
  imageUrls?(value: unknown): ImageUrlReference[];
  /**
   * For an insertion whose row will generate its key, the unique key of a
   * valid value, which tells two insertions of the same row apart. Undefined
   * when the value has none.
   */
  naturalKey?(value: unknown): object | undefined;
  /**
   * Other roots of the catalog a valid value names by their editorial UUID,
   * such as the member of a membership. Each one is published, or a
   * reservation this proposal creates, which the microchange then depends on.
   */
  rootReferences?(value: unknown): RootReference[];
  /**
   * Members of the target key that name another root of the catalog, such as
   * the artist of a presentation credit, by name. Each one is checked like a
   * root the value names: published, or a reservation this proposal creates.
   */
  keyRoots?: Record<string, KeyRoot>;
  /** Members of the target key that name a row of another relation of the root, by name. */
  keyRows?: Record<string, KeyRow>;
  /** Vocabulary entries the target key refers to, with paths inside `targetKey`. */
  keyReferences?(targetKey: object): VocabularyReference[];
  /**
   * Rules on the root's current data, such as a field its subtype lacks or an
   * interval with a field the change leaves as it is. Run when the change is
   * added, submitted and applied, so they always see the latest data. The
   * target key, when the operation has one, is valid.
   */
  targetProblems?(manager: EntityManager, root: EditorialEntity, value: unknown, targetKey: object | null): Promise<TargetProblem[]>;
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

/**
 * What a version of an operation keeps once a higher one replaces it: enough
 * to read the values written with it, never to apply them (ADR 0006).
 */
export type PublishedOperation = Pick<
  OperationDefinition,
  'entityType' | 'operation' | 'targetPath' | 'payloadSchemaVersion' | 'description' | 'valueSchema' | 'targetKeySchema'
>;

/** Current: the highest version of its selector, the only one a microchange applies with. */
export type VersionStatus = 'current' | 'obsolete';

/**
 * Every version ever published: a published version never changes or leaves,
 * so the history can always be read (see `payload-schemas.json`).
 */
export const OPERATIONS: readonly PublishedOperation[] = [
  IDENTITY_CREATION,
  ...IDENTITY_FIELD_CHANGES,
  ...IDENTITY_RELATION_CHANGES,
  ...ARTIST_CHANGES,
  ...MEMBERSHIP_CHANGES,
  withdrawalOf('identity'),
  ...WORK_CHANGES,
  withdrawalOf('work'),
  ...RECORDING_CHANGES,
  withdrawalOf('recording'),
  ...RELEASE_GROUP_CHANGES,
  withdrawalOf('release_group'),
  ...RELEASE_CHANGES,
  withdrawalOf('release'),
  ...TOUR_CHANGES,
  withdrawalOf('tour'),
  ...EVENT_CHANGES,
  withdrawalOf('event'),
];

/** Creations start from absence, so their base is always the empty envelope. */
export const ABSENT: ValueEnvelope = { exists: false };

let registry: readonly PublishedOperation[] = OPERATIONS;

/** The registry in use, which tests replace with `useOperations`. */
export function registeredOperations(): readonly PublishedOperation[] {
  return registry;
}

/**
 * Replaces the registry, so tests can publish a version that no real
 * selector has yet. Returns the function that restores the previous one.
 */
export function useOperations(operations: readonly PublishedOperation[]): () => void {
  const previous = registry;
  registry = operations;
  return () => {
    registry = previous;
  };
}

type Selector = Pick<PublishedOperation, 'entityType' | 'operation' | 'targetPath'>;

function versionsOf({ entityType, operation, targetPath }: Selector): PublishedOperation[] {
  return registry.filter((each) => each.entityType === entityType && each.operation === operation && each.targetPath === targetPath);
}

/** The current version of a selector, or undefined when the registry has none. */
export function currentVersionOf(selector: Selector): number | undefined {
  const versions = versionsOf(selector).map(({ payloadSchemaVersion }) => payloadSchemaVersion);
  return versions.length === 0 ? undefined : Math.max(...versions);
}

export function versionStatus(entry: PublishedOperation): VersionStatus {
  return entry.payloadSchemaVersion === currentVersionOf(entry) ? 'current' : 'obsolete';
}

/** The published JSON Schema of the proposed envelope of an operation: a value, or absence for a removal. */
export function payloadSchema(definition: PublishedOperation): object {
  const envelope =
    definition.valueSchema === null
      ? { required: ['exists'], properties: { exists: { const: false } } }
      : { required: ['exists', 'value'], properties: { exists: { const: true }, value: definition.valueSchema } };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, ...envelope };
}

export function operationId(definition: PublishedOperation): string {
  return `${definition.entityType}.${definition.operation}.${definition.targetPath}.v${definition.payloadSchemaVersion}`;
}

/** What a microchange names its registry entry by, besides its root's type; no version names no entry. */
export interface ChangeSelector {
  operation: string;
  targetPath: string;
  payloadSchemaVersion: number | undefined;
}

/**
 * How a microchange's selector and version resolve: to the definition it
 * applies with while its version is current, as obsolete once a higher one
 * replaced it, or to nothing outside the registry.
 */
export type Resolution =
  | { status: 'current'; definition: OperationDefinition }
  | { status: 'obsolete'; currentVersion: number }
  | { status: 'unregistered' };

/**
 * The single point where a microchange meets the registry. Only the current
 * version of a selector applies: there are no upcasts yet, so an older one
 * cannot be translated (ADR 0006).
 */
export function resolveOperation(
  entityType: EditorialEntityType,
  { operation, targetPath, payloadSchemaVersion }: ChangeSelector,
): Resolution {
  const versions = versionsOf({ entityType, operation: operation as ChangeOperation, targetPath });
  const entry = versions.find((each) => each.payloadSchemaVersion === payloadSchemaVersion);
  if (!entry) return { status: 'unregistered' };
  const currentVersion = currentVersionOf(entry)!;
  if (payloadSchemaVersion !== currentVersion) return { status: 'obsolete', currentVersion };
  if (!isExecutable(entry)) throw new Error(`The current version of ${operationId(entry)} has no definition to apply it with`);
  return { status: 'current', definition: entry };
}

/** Whether a microchange's version was replaced by a higher one, so it can no longer be read or applied. */
export function isObsolete(entityType: EditorialEntityType, change: ChangeSelector): boolean {
  return resolveOperation(entityType, change).status === 'obsolete';
}

/** The definition of a microchange known to be current, such as one being applied. */
export function currentOperation(
  entityType: EditorialEntityType,
  change: ChangeSelector,
): OperationDefinition | undefined {
  const resolution = resolveOperation(entityType, change);
  return resolution.status === 'current' ? resolution.definition : undefined;
}

/** The current definition of a selector, such as the removal that reads a row an insertion wrote. */
export function currentDefinitionOf(selector: Selector): OperationDefinition | undefined {
  const payloadSchemaVersion = currentVersionOf(selector);
  return payloadSchemaVersion === undefined ? undefined : currentOperation(selector.entityType, { ...selector, payloadSchemaVersion });
}

function isExecutable(entry: PublishedOperation): entry is OperationDefinition {
  return 'apply' in entry;
}

/** Whether any registry entry matches the given part of a selector. */
export function isRegistered(selector: { entityType?: string; operation?: string; targetPath?: string }): boolean {
  return registry.some((each) => Object.entries(selector).every(([member, value]) => each[member as keyof typeof selector] === value));
}

/** The entity types a reservation can be made for: those with a registered creation. */
export function creatableEntityTypes(): EditorialEntityType[] {
  return [...new Set(registry.filter(({ operation }) => operation === 'create_entity').map(({ entityType }) => entityType))];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
// Compiled on first use, so the entries of a registry a test publishes are validated too.
const validators = new WeakMap<PublishedOperation, ValidateFunction>();
const keyValidators = new WeakMap<PublishedOperation, ValidateFunction>();

function compiled(cache: WeakMap<PublishedOperation, ValidateFunction>, entry: PublishedOperation, schema: () => object): ValidateFunction {
  if (!cache.has(entry)) cache.set(entry, ajv.compile(schema()));
  return cache.get(entry)!;
}

/** Validates a proposed envelope against the published schema, then against the operation's own rules. */
export function validatePayload(definition: OperationDefinition, proposed: unknown): PayloadProblem[] {
  const validate = compiled(validators, definition, () => payloadSchema(definition));
  if (!validate(proposed)) return validate.errors!.map(toProblem);
  return definition.check((proposed as { value: unknown }).value);
}

/** Validates a target key against the operation's schema; paths are inside `targetKey`. */
export function validateTargetKey(definition: OperationDefinition, targetKey: unknown): PayloadProblem[] {
  const validate = compiled(keyValidators, definition, () => definition.targetKeySchema!);
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
