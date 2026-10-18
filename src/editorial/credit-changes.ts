import { EntityManager } from 'typeorm';
import { CreditScope, CreditValue, OwnerId, deleteCredit, findCredit, insertCredit, roleAllowsScope, updateCredit } from '../music/credits';
import { ContributionRole } from '../vocabularies/entities/contribution-role.entity';
import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { INT4, ROW_KEY, UUID } from './identity-relation-changes';
import type { OperationDefinition, RowKey, TargetProblem } from './operation-registry';

/*
 * Relation changes of the credits a root owns: the participation of an
 * identity, named by its editorial root, in a role valid for the scope of the
 * credit. A credit is keyed by its generated id. Credits have no unique key,
 * so two insertions of the same credit are two credits.
 */

const ABSENT: ValueEnvelope = { exists: false };

export const ENTITY_REFERENCE = (description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['entity_id'],
  properties: { entity_id: UUID },
  description,
});

const OPTIONAL_TEXT = { type: ['string', 'null'], maxLength: 10000 };
export const SOURCE_URL = { type: ['string', 'null'], maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' };

const CREDIT = {
  type: 'object',
  additionalProperties: false,
  required: ['identity', 'roleId', 'position'],
  properties: {
    identity: ENTITY_REFERENCE('Raíz editorial de la identidad acreditada: publicada, o creada en la misma propuesta'),
    roleId: { type: 'integer', minimum: 1, maximum: INT4, description: 'id en /v1/contribution-roles de un rol que admite este ámbito' },
    position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden editorial, no importancia ni porcentaje' },
    creditedAs: { type: ['string', 'null'], maxLength: 200, pattern: '\\S', description: 'Nombre literal de la fuente; null muestra el nombre visible' },
    details: OPTIONAL_TEXT,
    sourceText: OPTIONAL_TEXT,
    sourceUrl: SOURCE_URL,
  },
};

export interface CreditOwner {
  entityType: EditorialEntityType;
  targetPath: string;
  scope: CreditScope;
  /** The domain id of the root's work or recording, or null while it is only reserved. */
  ownerIdOf(manager: EntityManager, editorialEntityId: string): Promise<OwnerId | null>;
  /** What the root is, for descriptions: "la obra". */
  noun: string;
}

/** Add, update and remove operations on the credits of one kind of root. */
export function creditChanges(owner: CreditOwner): OperationDefinition[] {
  const { entityType, targetPath, scope, ownerIdOf, noun } = owner;
  const ownerOf = async (manager: EntityManager, root: EditorialEntity) => (await ownerIdOf(manager, root.id))!;
  const read = async (manager: EntityManager, root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const ownerId = await ownerIdOf(manager, root.id);
    const credit = ownerId === null ? null : await findCredit(manager, scope, ownerId, key!.id);
    return credit ? { exists: true, value: { ...credit } } : ABSENT;
  };

  /** What a proposed credit needs besides its schema: a role that exists and is creditable in this scope, and its identity. */
  const proposedCreditRules = {
    references: (value: unknown) => [{ vocabulary: 'contribution_roles' as const, id: (value as CreditValue).roleId, path: '/value/roleId' }],
    rootReferences: (value: unknown) => [
      { entityType: 'identity' as const, entityId: (value as CreditValue).identity.entity_id.toLowerCase(), path: '/value/identity/entity_id' },
    ],
    // Run on the current vocabulary each time, as an administrator may change the scopes of a role.
    targetProblems: async (manager: EntityManager, _root: EditorialEntity, value: unknown): Promise<TargetProblem[]> => {
      const { roleId } = value as CreditValue;
      const role = await manager.findOneBy(ContributionRole, { id: roleId });
      if (!role || (await roleAllowsScope(manager, roleId, scope))) return [];
      return [{ code: 'role_out_of_scope', detail: `The role ${role.slug} is not creditable in the ${scope} scope`, member: 'proposedValue/value/roleId' }];
    },
  };
  const base = { entityType, targetPath, payloadSchemaVersion: 1, check: () => [] } satisfies Partial<OperationDefinition>;

  return [
    {
      ...base,
      ...proposedCreditRules,
      operation: 'add_relation',
      description: `Acredita a una identidad en ${noun} con un rol del ámbito \`${scope}\`.`,
      valueSchema: CREDIT,
      targetKeySchema: null,
      read: async () => ABSENT,
      apply: async (manager, root, value, now) => {
        const ownerId = await ownerOf(manager, root);
        const id = await insertCredit(manager, scope, ownerId, value as CreditValue, now);
        return { afterValue: await read(manager, root, { id }), resultKey: { id } };
      },
    },
    {
      ...base,
      ...proposedCreditRules,
      operation: 'update_relation',
      description: `Sustituye los datos de un crédito existente de ${noun}.`,
      valueSchema: CREDIT,
      targetKeySchema: ROW_KEY,
      read,
      constraintProblems: async (manager, root, key) => ((await read(manager, root, key)).exists ? [] : ['El crédito ya no existe']),
      apply: async (manager, root, value, now, key) => {
        await updateCredit(manager, scope, await ownerOf(manager, root), key!.id, value as CreditValue, now);
        return { afterValue: await read(manager, root, key), resultKey: key };
      },
    },
    {
      ...base,
      operation: 'remove_relation',
      description: `Quita un crédito de ${noun}; la revisión guarda sus valores anteriores.`,
      valueSchema: null,
      targetKeySchema: ROW_KEY,
      references: () => [],
      read,
      apply: async (manager, root, _value, now, key) => {
        await deleteCredit(manager, scope, await ownerOf(manager, root), key!.id, now);
        return { afterValue: ABSENT, resultKey: key };
      },
    },
  ];
}
