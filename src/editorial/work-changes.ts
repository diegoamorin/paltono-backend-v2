import { EntityManager } from 'typeorm';
import { WORK_FIELDS, WorkFieldPath, WorkValue, createWork, findCreatedWork, hasValidIswcCheckDigit, iswcClashes, workIdOf, writeWorkField } from '../music/works';
import { creditChanges } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import type { OperationDefinition, PayloadProblem } from './operation-registry';

/*
 * Operations on a work root: its minimal creation, a title and nothing more,
 * changes to its fields and its credits. The slug is generated at creation and kept when
 * the title changes, so no operation proposes it.
 */

export const TITLE = { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' };
export const DESCRIPTION = { type: ['string', 'null'], maxLength: 10000 };
const ISWC = { type: ['string', 'null'], pattern: '^T[0-9]{10}$', description: 'ISWC canónico: T y diez dígitos, sin puntuación' };

const WORK = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { title: TITLE, description: DESCRIPTION, iswc: ISWC },
};

const noReferences = { references: () => [] } satisfies Pick<OperationDefinition, 'references'>;

function checkIswc(iswc: unknown, path: string): PayloadProblem[] {
  return typeof iswc === 'string' && !hasValidIswcCheckDigit(iswc) ? [{ path, detail: 'iswc has a wrong check digit' }] : [];
}

const WORK_CREATION: OperationDefinition = {
  entityType: 'work',
  operation: 'create_entity',
  targetPath: 'works',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una obra: su título. El slug se genera desde el título, se conserva aunque cambie y resuelve colisiones ' +
    'con un sufijo (`butter-2`). El ISWC, opcional, es único y valida su dígito de control.',
  valueSchema: WORK,
  targetKeySchema: null,
  check: (value) => checkIswc((value as WorkValue).iswc, '/value/iswc'),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedWork(manager, root.id);
    return created ? { exists: true, value: { ...created.value } } : { exists: false };
  },
  constraintProblems: (manager, root, _key, value) => iswcClashes(manager, (value as WorkValue).iswc, root.id),
  apply: async (manager, root, value, now) => {
    await createWork(manager, root.id, value as WorkValue, now);
    const { work, value: created } = (await findCreatedWork(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } }, resultKey: { id: work.id, slug: work.slug } };
  },
};

const FIELD_RULES: Record<WorkFieldPath, { description: string; schema: object }> = {
  'works.title': { description: 'Título de la obra. El slug no cambia.', schema: TITLE },
  'works.description': { description: 'Descripción de la obra, o null.', schema: DESCRIPTION },
  'works.iswc': { description: 'ISWC canónico de la obra, único y con dígito de control válido, o null.', schema: ISWC },
};

const WORK_FIELD_CHANGES: OperationDefinition[] = (Object.keys(WORK_FIELDS) as WorkFieldPath[]).map((path) => ({
  entityType: 'work',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: FIELD_RULES[path].description,
  valueSchema: FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'works.iswc' ? checkIswc(value, '/value') : []),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedWork(manager, root.id);
    return created ? envelope(created.value[WORK_FIELDS[path]]) : { exists: false };
  },
  constraintProblems: (manager, root, _key, value) => (path === 'works.iswc' ? iswcClashes(manager, value as string | null, root.id) : Promise.resolve([])),
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeWorkField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

export const WORK_CHANGES: OperationDefinition[] = [
  WORK_CREATION,
  ...WORK_FIELD_CHANGES,
  ...creditChanges({ entityType: 'work', targetPath: 'work_contributions', scope: 'work', ownerIdOf: workIdOf, noun: 'la obra' }),
];

export function envelope(value: unknown): ValueEnvelope {
  return { exists: true, value: (value ?? null) as Extract<ValueEnvelope, { exists: true }>['value'] };
}
