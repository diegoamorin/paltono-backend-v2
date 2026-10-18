import { EntityManager } from 'typeorm';
import { RELEASE_GROUP_TYPES } from '../music/entities/release.entity';
import { PartialDateValue } from '../music/recordings';
import {
  RELEASE_FIELDS,
  RELEASE_GROUP_FIELDS,
  ReleaseDateValue,
  ReleaseFieldPath,
  ReleaseGroupFieldPath,
  ReleaseGroupValue,
  ReleaseValue,
  RootReference,
  closesRepackageCycle,
  createRelease,
  createReleaseGroup,
  editionNameClashes,
  findCreatedRelease,
  findCreatedReleaseGroup,
  releaseFieldValue,
  writeReleaseField,
  writeReleaseGroupField,
} from '../music/releases';
import { ENTITY_REFERENCE, SOURCE_URL } from './credit-changes';
import { RELEASE_CREDIT_CHANGES } from './release-credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { PARTIAL_DATE, daysInMonth } from './identity-creation';
import type { OperationDefinition, PayloadProblem, RootReference as NamedRoot, TargetProblem } from './operation-registry';
import { DESCRIPTION, envelope } from './work-changes';

/*
 * Operations on release group and release roots. A release group needs only a
 * title and a type and may be published before any release, to record an
 * announcement. A release needs only its release group, published or created
 * by the same proposal; moving it to another group is a field change of the
 * release. Presentation credits of a release group are in
 * `release-credit-changes.ts`.
 */

const ABSENT: ValueEnvelope = { exists: false };
const noReferences = { references: () => [] } satisfies Pick<OperationDefinition, 'references'>;

const TITLE = { type: 'string', minLength: 1, maxLength: 512, pattern: '\\S' };
const OPTIONAL_TITLE = { type: ['string', 'null'], minLength: 1, maxLength: 512, pattern: '\\S', description: 'null muestra el título del lanzamiento' };
const TYPE = { enum: RELEASE_GROUP_TYPES, description: 'Como lo anunció su artista o agencia; nunca se calcula por número de pistas' };
const REPACKAGE_OF = {
  anyOf: [ENTITY_REFERENCE('Raíz editorial del lanzamiento original: publicado y distinto de este, sin ciclos'), { type: 'null' }],
};
const EDITION_NAME = {
  type: ['string', 'null'],
  minLength: 1,
  maxLength: 200,
  pattern: '\\S',
  description: 'Deluxe, Sped Up, Japan Edition…; null para la edición estándar, como mucho una por lanzamiento',
};
const RELEASE_TIME = { type: ['string', 'null'], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'Hora local anunciada, HH:MM' };
const TIMEZONE = { type: ['string', 'null'], maxLength: 64, description: 'Zona IANA, como Asia/Seoul; nunca se deduce del país' };
const IS_CANCELLED = { type: 'boolean', description: 'Una edición cancelada no tiene cuenta regresiva ni se considera publicada' };

const RELEASE_GROUP = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type'],
  properties: { title: TITLE, type: TYPE, description: DESCRIPTION, repackageOf: REPACKAGE_OF },
};

const RELEASE_DATE = {
  type: 'object',
  additionalProperties: false,
  required: ['releaseDate', 'releaseTime', 'timezone'],
  properties: { releaseDate: PARTIAL_DATE, releaseTime: RELEASE_TIME, timezone: TIMEZONE },
};

const RELEASE = {
  type: 'object',
  additionalProperties: false,
  required: ['releaseGroup'],
  properties: {
    releaseGroup: ENTITY_REFERENCE('Raíz editorial del lanzamiento: publicado, o creado en la misma propuesta'),
    title: OPTIONAL_TITLE,
    editionName: EDITION_NAME,
    releaseDate: PARTIAL_DATE,
    releaseTime: RELEASE_TIME,
    timezone: TIMEZONE,
    coverArtUrl: SOURCE_URL,
    isCancelled: IS_CANCELLED,
  },
};

/** A root a value names, at a path inside the proposed envelope. */
const named = (entityType: 'release_group', reference: RootReference | null | undefined, path: string): NamedRoot[] =>
  typeof reference?.entity_id === 'string' ? [{ entityType, entityId: reference.entity_id.toLowerCase(), path }] : [];

// Release groups

const RELEASE_GROUP_CREATION: OperationDefinition = {
  entityType: 'release_group',
  operation: 'create_entity',
  targetPath: 'release_groups',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de un lanzamiento: título y tipo (`album`, `ep`, `single` o `compilation`). Puede publicarse sin ediciones para ' +
    'registrar un anuncio. `repackageOf` vincula un repackage con su lanzamiento original publicado.',
  valueSchema: RELEASE_GROUP,
  targetKeySchema: null,
  check: () => [],
  ...noReferences,
  rootReferences: (value) => named('release_group', (value as ReleaseGroupValue).repackageOf, '/value/repackageOf/entity_id'),
  read: async (manager, root) => {
    const created = await findCreatedReleaseGroup(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  apply: async (manager, root, value, now) => {
    const group = await createReleaseGroup(manager, root.id, value as ReleaseGroupValue, now);
    const { value: created } = (await findCreatedReleaseGroup(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: group.id, publicId: group.publicId } };
  },
};

const GROUP_FIELD_RULES: Record<ReleaseGroupFieldPath, { description: string; schema: object }> = {
  'release_groups.title': { description: 'Título del lanzamiento.', schema: TITLE },
  'release_groups.type': { description: 'Tipo del lanzamiento, como lo anunció su artista o agencia.', schema: TYPE },
  'release_groups.description': { description: 'Descripción del lanzamiento, o null.', schema: DESCRIPTION },
  'release_groups.repackage_of': {
    description: 'Lanzamiento original que relanza este repackage, o null. Debe estar publicado y ser distinto; se admiten cadenas, no ciclos.',
    schema: REPACKAGE_OF,
  },
};

/** A repackage link never closes a cycle; checked under the lock that serializes repackage links. */
async function repackageProblems(manager: EntityManager, root: EditorialEntity, value: unknown): Promise<TargetProblem[]> {
  const original = value as RootReference | null;
  if (original === null || !(await closesRepackageCycle(manager, root.id, original))) return [];
  return [{ code: 'repackage_cycle', detail: 'The original is a repackage of this release group, directly or through others', member: 'proposedValue/value' }];
}

const RELEASE_GROUP_FIELD_CHANGES: OperationDefinition[] = (Object.keys(RELEASE_GROUP_FIELDS) as ReleaseGroupFieldPath[]).map((path) => ({
  entityType: 'release_group',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: GROUP_FIELD_RULES[path].description,
  valueSchema: GROUP_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: () => [],
  ...noReferences,
  ...(path === 'release_groups.repackage_of'
    ? {
        rootReferences: (value: unknown) => named('release_group', value as RootReference | null, '/value/entity_id'),
        targetProblems: repackageProblems,
      }
    : {}),
  read: async (manager, root) => {
    const created = await findCreatedReleaseGroup(manager, root.id);
    return created ? envelope(created.value[RELEASE_GROUP_FIELDS[path]]) : ABSENT;
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeReleaseGroupField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

// Releases

/** A date names a real day; the time and its zone go together, only with a complete date, and the zone is an IANA one. */
function checkReleaseDate({ releaseDate, releaseTime, timezone }: Partial<ReleaseDateValue>, at: string): PayloadProblem[] {
  const problems: PayloadProblem[] = [];
  const date = releaseDate as PartialDateValue | null | undefined;
  if (date?.day !== undefined && date.month !== undefined && date.day > daysInMonth(date.year, date.month)) {
    problems.push({ path: `${at}/releaseDate/day`, detail: 'releaseDate is not a calendar date' });
  }
  const hasTime = releaseTime !== undefined && releaseTime !== null;
  const hasZone = timezone !== undefined && timezone !== null;
  if (hasTime !== hasZone) {
    problems.push({ path: `${at}/${hasTime ? 'timezone' : 'releaseTime'}`, detail: 'releaseTime and timezone go together' });
  } else if (hasTime && date?.day === undefined) {
    problems.push({ path: `${at}/releaseTime`, detail: 'releaseTime requires a complete releaseDate' });
  }
  if (hasZone && !isIanaZone(timezone)) problems.push({ path: `${at}/timezone`, detail: 'timezone is not an IANA time zone' });
  return problems;
}

/** An IANA zone name such as Asia/Seoul or UTC, never an offset. */
export function isIanaZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const RELEASE_CREATION: OperationDefinition = {
  entityType: 'release',
  operation: 'create_entity',
  targetPath: 'releases',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una edición: su lanzamiento, publicado o creado en la misma propuesta. Título, nombre de edición, fecha, ' +
    'portada y pistas pueden ser desconocidos. Como mucho una edición sin nombre por lanzamiento. `releaseTime` y `timezone` ' +
    '(zona IANA) van juntos y solo con fecha completa.',
  valueSchema: RELEASE,
  targetKeySchema: null,
  check: (value) => checkReleaseDate(value as ReleaseValue, '/value'),
  ...noReferences,
  rootReferences: (value) => named('release_group', (value as ReleaseValue).releaseGroup, '/value/releaseGroup/entity_id'),
  read: async (manager, root) => {
    const created = await findCreatedRelease(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  constraintProblems: (manager, root, _key, value) => {
    const { releaseGroup, editionName } = value as ReleaseValue;
    return editionNameClashes(manager, releaseGroup, editionName ?? null, root.id);
  },
  apply: async (manager, root, value, now) => {
    const release = await createRelease(manager, root.id, value as ReleaseValue, now);
    const { value: created } = (await findCreatedRelease(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: release.id, publicId: release.publicId } };
  },
};

const RELEASE_FIELD_RULES: Record<ReleaseFieldPath, { description: string; schema: object }> = {
  'releases.release_group': {
    description: 'Mueve la edición a otro lanzamiento, publicado o creado en la misma propuesta. No fusiona lanzamientos.',
    schema: ENTITY_REFERENCE('Raíz editorial del lanzamiento de destino'),
  },
  'releases.title': { description: 'Título literal de la edición, o null para mostrar el del lanzamiento.', schema: OPTIONAL_TITLE },
  'releases.edition_name': { description: 'Nombre de la edición, o null para la estándar; único en su lanzamiento.', schema: EDITION_NAME },
  'releases.release_date': {
    description: 'Fecha parcial de salida con su hora local y zona IANA, que cambian juntas. Un retraso se registra cambiándolas.',
    schema: RELEASE_DATE,
  },
  'releases.cover_art_url': { description: 'URL HTTP(S) de la portada, o null si se desconoce.', schema: SOURCE_URL },
  'releases.is_cancelled': { description: 'Si la edición está cancelada.', schema: IS_CANCELLED },
};

/** The release group and edition name a release would have once a field change applies. */
async function editionAfter(manager: EntityManager, root: EditorialEntity, path: ReleaseFieldPath, value: unknown) {
  const current = (await findCreatedRelease(manager, root.id))?.value;
  if (!current) return null;
  if (path === 'releases.release_group') return { group: value as RootReference, editionName: current.editionName };
  if (path === 'releases.edition_name') return { group: current.releaseGroup, editionName: value as string | null };
  return null;
}

const RELEASE_FIELD_CHANGES: OperationDefinition[] = (Object.keys(RELEASE_FIELDS) as ReleaseFieldPath[]).map((path) => ({
  entityType: 'release',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: RELEASE_FIELD_RULES[path].description,
  valueSchema: RELEASE_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'releases.release_date' ? checkReleaseDate(value as ReleaseDateValue, '/value') : []),
  ...noReferences,
  ...(path === 'releases.release_group'
    ? { rootReferences: (value: unknown) => named('release_group', value as RootReference, '/value/entity_id') }
    : {}),
  read: async (manager, root) => {
    const created = await findCreatedRelease(manager, root.id);
    return created ? envelope(releaseFieldValue(created.value, path)) : ABSENT;
  },
  constraintProblems: async (manager, root, _key, value) => {
    const after = await editionAfter(manager, root, path, value);
    return after ? editionNameClashes(manager, after.group, after.editionName, root.id) : [];
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeReleaseField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

export const RELEASE_GROUP_CHANGES: OperationDefinition[] = [RELEASE_GROUP_CREATION, ...RELEASE_GROUP_FIELD_CHANGES, ...RELEASE_CREDIT_CHANGES];

export const RELEASE_CHANGES: OperationDefinition[] = [RELEASE_CREATION, ...RELEASE_FIELD_CHANGES];
