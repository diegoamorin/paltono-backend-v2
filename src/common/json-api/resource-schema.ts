/**
 * How a model becomes a JSON:API resource object. Attributes and relationships
 * are declared by name so sparse fieldsets and `include` paths can be validated
 * before any data is loaded.
 */
export interface ResourceSchema<T> {
  type: string;
  id(model: T): string;
  attributes: Record<string, (model: T) => unknown>;
  relationships?: Record<string, RelationshipSchema<T>>;
  /** Resource-level `meta`, outside sparse fieldsets. */
  meta?(model: T): Record<string, unknown>;
}

/** A schema whose model type is irrelevant, for code that only reads names. */
export type AnyResourceSchema = ResourceSchema<any>;

export interface RelationshipSchema<T> {
  /** Lazy, so schemas can refer to each other. */
  schema(): AnyResourceSchema;
  /**
   * The related model, models, or `null` for an empty to-one relationship.
   * Returns `undefined` when the relationship was not loaded; it is then omitted.
   */
  get(model: T): unknown;
}

export function defineResource<T>(schema: ResourceSchema<T>): ResourceSchema<T> {
  return schema;
}

/** Attribute and relationship names, which share one namespace in JSON:API. */
export function fieldNames(schema: AnyResourceSchema): string[] {
  return [...Object.keys(schema.attributes), ...Object.keys(schema.relationships ?? {})];
}
