import { EntityManager } from 'typeorm';
import { CATALOG_IMAGE_URL, imageUrlAt } from '../images/catalog-image-urls';
import { RELEASE_TYPES } from '../music/entities/release.entity';
import {
  EDITION_FIELDS,
  EditionFieldPath,
  EditionValue,
  RELEASE_FIELDS,
  ReleaseDateValue,
  ReleaseFieldPath,
  ReleaseValue,
  RootReference,
  closesRepackageCycle,
  createEdition,
  createRelease,
  editionFieldValue,
  editionIdOf,
  editionNameClashes,
  findCreatedEdition,
  findCreatedRelease,
  writeEditionField,
  writeReleaseField,
} from '../music/releases';
import { ENTITY_REFERENCE, creditChanges } from './credit-changes';
import { RELEASE_CREDIT_CHANGES } from './release-credit-changes';
import { EDITION_TRACK_CHANGES } from './track-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { PARTIAL_DATE, partialDateProblems } from './identity-creation';
import type { OperationDefinition, PayloadProblem, RootReference as NamedRoot, TargetProblem } from './operation-registry';
import { DESCRIPTION, envelope } from './work-changes';

/*
 * Operations on release and edition roots. A release needs only a title and a
 * type and may be published before any edition, to record an announcement. An
 * edition needs only its release, published or created by the same proposal;
 * moving it to another release is a field change of the edition. Artist
 * credits of a release are in `release-credit-changes.ts`; the tracks of an
 * edition, in `track-changes.ts`.
 */

const ABSENT: ValueEnvelope = { exists: false };
const noReferences = { references: () => [] } satisfies Pick<OperationDefinition, 'references'>;

const TITLE = { type: 'string', minLength: 1, maxLength: 512, pattern: '\\S' };
const OPTIONAL_TITLE = { type: ['string', 'null'], minLength: 1, maxLength: 512, pattern: '\\S', description: 'null muestra el título del lanzamiento' };
const TYPE = { enum: RELEASE_TYPES, description: 'Como lo anunció su artista o agencia; nunca se calcula por número de pistas' };
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

const RELEASE = {
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

const EDITION = {
  type: 'object',
  additionalProperties: false,
  required: ['release'],
  properties: {
    release: ENTITY_REFERENCE('Raíz editorial del lanzamiento: publicado, o creado en la misma propuesta'),
    title: OPTIONAL_TITLE,
    editionName: EDITION_NAME,
    releaseDate: PARTIAL_DATE,
    releaseTime: RELEASE_TIME,
    timezone: TIMEZONE,
    coverArtUrl: CATALOG_IMAGE_URL,
    isCancelled: IS_CANCELLED,
  },
};

/** A release a value names, at a path inside the proposed envelope. */
const namedRelease = (reference: RootReference | null | undefined, path: string): NamedRoot[] =>
  typeof reference?.entity_id === 'string' ? [{ entityType: 'release', entityId: reference.entity_id.toLowerCase(), path }] : [];

// Releases

const RELEASE_CREATION: OperationDefinition = {
  entityType: 'release',
  operation: 'create_entity',
  targetPath: 'releases',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de un lanzamiento: título y tipo (`album`, `ep`, `single` o `compilation`). Puede publicarse sin ediciones para ' +
    'registrar un anuncio. `repackageOf` vincula un repackage con su lanzamiento original publicado.',
  valueSchema: RELEASE,
  targetKeySchema: null,
  check: () => [],
  ...noReferences,
  rootReferences: (value) => namedRelease((value as ReleaseValue).repackageOf, '/value/repackageOf/entity_id'),
  read: async (manager, root) => {
    const created = await findCreatedRelease(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  apply: async (manager, root, value, now) => {
    const release = await createRelease(manager, root.id, value as ReleaseValue, now);
    const { value: created } = (await findCreatedRelease(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: release.id, publicId: release.publicId } };
  },
};

const RELEASE_FIELD_RULES: Record<ReleaseFieldPath, { description: string; schema: object }> = {
  'releases.title': { description: 'Título del lanzamiento.', schema: TITLE },
  'releases.type': { description: 'Tipo del lanzamiento, como lo anunció su artista o agencia.', schema: TYPE },
  'releases.description': { description: 'Descripción del lanzamiento, o null.', schema: DESCRIPTION },
  'releases.repackage_of': {
    description: 'Lanzamiento original que relanza este repackage, o null. Debe estar publicado y ser distinto; se admiten cadenas, no ciclos.',
    schema: REPACKAGE_OF,
  },
};

/** A repackage link never closes a cycle; checked under the lock that serializes repackage links. */
async function repackageProblems(manager: EntityManager, root: EditorialEntity, value: unknown): Promise<TargetProblem[]> {
  const original = value as RootReference | null;
  if (original === null || !(await closesRepackageCycle(manager, root.id, original))) return [];
  return [{ code: 'repackage_cycle', detail: 'The original is a repackage of this release, directly or through others', member: 'proposedValue/value' }];
}

const RELEASE_FIELD_CHANGES: OperationDefinition[] = (Object.keys(RELEASE_FIELDS) as ReleaseFieldPath[]).map((path) => ({
  entityType: 'release',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: RELEASE_FIELD_RULES[path].description,
  valueSchema: RELEASE_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: () => [],
  ...noReferences,
  ...(path === 'releases.repackage_of'
    ? {
        rootReferences: (value: unknown) => namedRelease(value as RootReference | null, '/value/entity_id'),
        targetProblems: repackageProblems,
      }
    : {}),
  read: async (manager, root) => {
    const created = await findCreatedRelease(manager, root.id);
    return created ? envelope(created.value[RELEASE_FIELDS[path]]) : ABSENT;
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeReleaseField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

// Editions

/** A date names a real day; the time and its zone go together, only with a complete date, and the zone is an IANA one. */
function checkReleaseDate({ releaseDate, releaseTime, timezone }: Partial<ReleaseDateValue>, at: string): PayloadProblem[] {
  const problems = partialDateProblems('releaseDate', releaseDate, `${at}/releaseDate`);
  const hasTime = releaseTime !== undefined && releaseTime !== null;
  const hasZone = timezone !== undefined && timezone !== null;
  if (hasTime !== hasZone) {
    problems.push({ path: `${at}/${hasTime ? 'timezone' : 'releaseTime'}`, detail: 'releaseTime and timezone go together' });
  } else if (hasTime && releaseDate?.day === undefined) {
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

const EDITION_CREATION: OperationDefinition = {
  entityType: 'edition',
  operation: 'create_entity',
  targetPath: 'editions',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de una edición: su lanzamiento, publicado o creado en la misma propuesta. Título, nombre de edición, fecha, ' +
    'portada y pistas pueden ser desconocidos. Como mucho una edición sin nombre por lanzamiento. `releaseTime` y `timezone` ' +
    '(zona IANA) van juntos y solo con fecha completa.',
  valueSchema: EDITION,
  targetKeySchema: null,
  check: (value) => checkReleaseDate(value as EditionValue, '/value'),
  ...noReferences,
  imageUrls: (value) => imageUrlAt((value as EditionValue).coverArtUrl, '/value/coverArtUrl'),
  rootReferences: (value) => namedRelease((value as EditionValue).release, '/value/release/entity_id'),
  read: async (manager, root) => {
    const created = await findCreatedEdition(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  constraintProblems: (manager, root, _key, value) => {
    const { release, editionName } = value as EditionValue;
    return editionNameClashes(manager, release, editionName ?? null, root.id);
  },
  apply: async (manager, root, value, now) => {
    const edition = await createEdition(manager, root.id, value as EditionValue, now);
    const { value: created } = (await findCreatedEdition(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: edition.id, publicId: edition.publicId } };
  },
};

const EDITION_FIELD_RULES: Record<EditionFieldPath, { description: string; schema: object }> = {
  'editions.release': {
    description: 'Mueve la edición a otro lanzamiento, publicado o creado en la misma propuesta. No fusiona lanzamientos.',
    schema: ENTITY_REFERENCE('Raíz editorial del lanzamiento de destino'),
  },
  'editions.title': { description: 'Título literal de la edición, o null para mostrar el del lanzamiento.', schema: OPTIONAL_TITLE },
  'editions.edition_name': { description: 'Nombre de la edición, o null para la estándar; único en su lanzamiento.', schema: EDITION_NAME },
  'editions.release_date': {
    description: 'Fecha parcial de salida con su hora local y zona IANA, que cambian juntas. Un retraso se registra cambiándolas.',
    schema: RELEASE_DATE,
  },
  'editions.cover_art_url': {
    description: 'Portada: la URL de una imagen subida para el catálogo con POST /v1/images, o null si se desconoce.',
    schema: CATALOG_IMAGE_URL,
  },
  'editions.is_cancelled': { description: 'Si la edición está cancelada.', schema: IS_CANCELLED },
};

/** The release and edition name an edition would have once a field change applies. */
async function editionAfter(manager: EntityManager, root: EditorialEntity, path: EditionFieldPath, value: unknown) {
  const current = (await findCreatedEdition(manager, root.id))?.value;
  if (!current) return null;
  if (path === 'editions.release') return { release: value as RootReference, editionName: current.editionName };
  if (path === 'editions.edition_name') return { release: current.release, editionName: value as string | null };
  return null;
}

const EDITION_FIELD_CHANGES: OperationDefinition[] = (Object.keys(EDITION_FIELDS) as EditionFieldPath[]).map((path) => ({
  entityType: 'edition',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: EDITION_FIELD_RULES[path].description,
  valueSchema: EDITION_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'editions.release_date' ? checkReleaseDate(value as ReleaseDateValue, '/value') : []),
  ...noReferences,
  ...(path === 'editions.cover_art_url' ? { imageUrls: (value: unknown) => imageUrlAt(value, '/value') } : {}),
  ...(path === 'editions.release' ? { rootReferences: (value: unknown) => namedRelease(value as RootReference, '/value/entity_id') } : {}),
  read: async (manager, root) => {
    const created = await findCreatedEdition(manager, root.id);
    return created ? envelope(editionFieldValue(created.value, path)) : ABSENT;
  },
  constraintProblems: async (manager, root, _key, value) => {
    const after = await editionAfter(manager, root, path, value);
    return after ? editionNameClashes(manager, after.release, after.editionName, root.id) : [];
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeEditionField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

export const RELEASE_CHANGES: OperationDefinition[] = [RELEASE_CREATION, ...RELEASE_FIELD_CHANGES, ...RELEASE_CREDIT_CHANGES];

export const EDITION_CHANGES: OperationDefinition[] = [
  EDITION_CREATION,
  ...EDITION_FIELD_CHANGES,
  ...creditChanges({ entityType: 'edition', targetPath: 'edition_contributions', scope: 'edition', ownerIdOf: editionIdOf, noun: 'la edición' }),
  ...EDITION_TRACK_CHANGES,
];
