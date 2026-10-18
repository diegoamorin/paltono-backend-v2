import { EditorialEntity, EditorialEntityType } from './entities/editorial-entity.entity';
import type { OperationDefinition } from './operation-registry';

/*
 * `withdraw_entity`: the logical withdrawal of a published root. Its target is
 * the root's editorial state, never its rows: the domain rows, ids and history
 * stay, and the public entry shows a withdrawal notice instead of its content.
 * Anyone may propose it; only an administrator applies it.
 */

export const WITHDRAWAL_TARGET_PATH = 'publication_status';

/** The withdrawal of a root of the given type. */
export function withdrawalOf(entityType: EditorialEntityType): OperationDefinition {
  return {
    entityType,
    operation: 'withdraw_entity',
    targetPath: WITHDRAWAL_TARGET_PATH,
    payloadSchemaVersion: 1,
    description:
      'Retira una ficha publicada: queda `withdrawn` con su aviso, conservando IDs, filas e historial. Solo un administrador la aplica.',
    valueSchema: { const: 'withdrawn' },
    targetKeySchema: null,
    check: () => [],
    references: () => [],
    read: async (_manager, root) => ({ exists: true, value: root.publicationStatus }),
    apply: async (manager, root, _value, now) => {
      await manager.update(EditorialEntity, { id: root.id }, { publicationStatus: 'withdrawn', withdrawnAt: now });
      return { afterValue: { exists: true, value: 'withdrawn' }, resultKey: null };
    },
  };
}
