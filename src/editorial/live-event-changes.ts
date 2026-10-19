import { EntityManager } from 'typeorm';
import { hasArtist } from '../catalog-identities/artist-relations';
import { identityIdOf } from '../catalog-identities/identity-relations';
import { EVENT_STATUSES, LINK_PURPOSES, LIVE_ARTIST_ROLES, TOUR_STATUSES } from '../live-events/entities/live-event.entity';
import {
  EVENT_FIELDS,
  EventFieldPath,
  EventLocationValue,
  EventScheduleValue,
  EventValue,
  LinkValue,
  LiveArtistValue,
  LiveRoot,
  OrganizerValue,
  RootReference,
  TOUR_FIELDS,
  TourFieldPath,
  TourScheduleValue,
  TourValue,
  createEvent,
  createTour,
  deleteLink,
  deleteLiveArtist,
  deleteOrganizer,
  eventFieldValue,
  eventIdOf,
  findCreatedEvent,
  findCreatedTour,
  findLink,
  findLinkByUniqueKey,
  findLiveArtist,
  findOrganizer,
  insertLink,
  linkClashes,
  tourFieldValue,
  tourIdOf,
  updateLink,
  writeEventField,
  writeLiveArtist,
  writeOrganizer,
  writeTourField,
} from '../live-events/live-events';
import { artistIdOfIdentity } from '../music/releases';
import { PartialDateValue } from '../music/recordings';
import { ENTITY_REFERENCE, SOURCE_URL } from './credit-changes';
import { EditorialEntity } from './entities/editorial-entity.entity';
import { ValueEnvelope } from './entities/proposal-change.entity';
import { COUNTRY_ID, PARTIAL_DATE, daysInMonth, interval } from './identity-creation';
import { ROW_KEY, envelope as rowEnvelope, reference } from './identity-relation-changes';
import type { OperationDefinition, PayloadProblem, RootReference as NamedRoot, RowKey, TargetProblem, VocabularyReference } from './operation-registry';
import { isIanaZone } from './release-changes';
import { DESCRIPTION, envelope } from './work-changes';

/*
 * Operations on tour and event roots. A tour needs a title and its business
 * status; an event, a title, its status and optionally its tour, published or
 * created by the same proposal. The business status is separate from the
 * publication status and a tour's never cascades into its events. Schedules
 * change as a whole, status and date together, so a postponement clears the
 * date it had (kept in the revisions) and a rescheduling sets it again. The
 * countries and dates of a tour are never proposed: they come from its events.
 *
 * Artists and organizers are keyed by the root and the identity they name, by
 * its editorial UUID (`keyRoots`); links, by their generated id.
 */

const ABSENT: ValueEnvelope = { exists: false };
const noReferences = { references: () => [] } satisfies Pick<OperationDefinition, 'references'>;

/** A text that is not blank, up to `maxLength`; `nullable` also accepts null. */
const text = (maxLength: number, nullable = false) => ({ type: nullable ? ['string', 'null'] : 'string', minLength: 1, maxLength, pattern: '\\S' });

const TITLE = text(512);
const IMAGE_URL = SOURCE_URL;
const TOUR_STATUS = { enum: TOUR_STATUSES, description: 'Estado de negocio, separado del de publicación; `scheduled` exige al menos el año de inicio' };
const EVENT_STATUS = {
  enum: EVENT_STATUSES,
  description: 'Estado de negocio, separado del de publicación; `scheduled` exige fecha completa y `postponed`, ninguna fecha ni hora',
};
const START_TIME = { type: ['string', 'null'], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'Hora local, HH:MM; exige fecha completa y zona' };
const TIMEZONE = { type: ['string', 'null'], maxLength: 64, description: 'Zona IANA, como Asia/Seoul; puede conocerse sin hora y nunca se deduce del país' };
const CITY = text(200, true);
const VENUE_NAME = text(300, true);
const TOUR_REFERENCE = { anyOf: [ENTITY_REFERENCE('Raíz editorial del tour: publicado, o creado en la misma propuesta'), { type: 'null' }] };

const TOUR = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'status'],
  properties: { title: TITLE, status: TOUR_STATUS, startDate: PARTIAL_DATE, endDate: PARTIAL_DATE, description: DESCRIPTION, imageUrl: IMAGE_URL },
};

const TOUR_SCHEDULE = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'startDate', 'endDate'],
  properties: { status: TOUR_STATUS, startDate: PARTIAL_DATE, endDate: PARTIAL_DATE },
};

const EVENT = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'status'],
  properties: {
    title: TITLE,
    status: EVENT_STATUS,
    tour: TOUR_REFERENCE,
    startDate: PARTIAL_DATE,
    startTime: START_TIME,
    timezone: TIMEZONE,
    countryId: COUNTRY_ID,
    city: CITY,
    venueName: VENUE_NAME,
    description: DESCRIPTION,
    imageUrl: IMAGE_URL,
  },
};

const EVENT_SCHEDULE = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'startDate', 'startTime', 'timezone'],
  properties: { status: EVENT_STATUS, startDate: PARTIAL_DATE, startTime: START_TIME, timezone: TIMEZONE },
};

const EVENT_LOCATION = {
  type: 'object',
  additionalProperties: false,
  required: ['countryId', 'city', 'venueName'],
  properties: { countryId: COUNTRY_ID, city: CITY, venueName: VENUE_NAME },
};

const namedTour = (tour: RootReference | null | undefined, path: string): NamedRoot[] =>
  typeof tour?.entity_id === 'string' ? [{ entityType: 'tour', entityId: tour.entity_id.toLowerCase(), path }] : [];

const countryReference = (countryId: number | null | undefined, path: string): VocabularyReference[] =>
  typeof countryId === 'number' ? [{ vocabulary: 'countries', id: countryId, path }] : [];

function checkDate(date: PartialDateValue | null | undefined, path: string, name: string): PayloadProblem[] {
  if (date?.day !== undefined && date.month !== undefined && date.day > daysInMonth(date.year, date.month)) {
    return [{ path: `${path}/day`, detail: `${name} is not a calendar date` }];
  }
  return [];
}

/** A tour's dates are real days in a possible order; a scheduled tour has at least its start year. */
function checkTourSchedule({ status, startDate, endDate }: Partial<TourScheduleValue>, at: string): PayloadProblem[] {
  const problems = [...checkDate(startDate, `${at}/startDate`, 'startDate'), ...checkDate(endDate, `${at}/endDate`, 'endDate')];
  if (status === 'scheduled' && !startDate) problems.push({ path: `${at}/startDate`, detail: 'a scheduled tour has at least a known start year' });
  // Partial dates are intervals; only an end wholly before the start is impossible.
  if (startDate && endDate && interval(endDate).last < interval(startDate).first) {
    problems.push({ path: `${at}/endDate`, detail: 'endDate is before startDate' });
  }
  return problems;
}

/**
 * A concert's date is a real day; its time needs a complete date and its IANA
 * zone, which may stand alone. A scheduled concert has a complete date and a
 * postponed one has neither date nor time.
 */
function checkEventSchedule({ status, startDate, startTime, timezone }: Partial<EventScheduleValue>, at: string): PayloadProblem[] {
  const problems = checkDate(startDate, `${at}/startDate`, 'startDate');
  const hasTime = startTime !== undefined && startTime !== null;
  const hasZone = timezone !== undefined && timezone !== null;
  if (hasTime && startDate?.day === undefined) problems.push({ path: `${at}/startTime`, detail: 'startTime requires a complete startDate' });
  if (hasTime && !hasZone) problems.push({ path: `${at}/timezone`, detail: 'startTime requires its timezone' });
  if (hasZone && !isIanaZone(timezone)) problems.push({ path: `${at}/timezone`, detail: 'timezone is not an IANA time zone' });
  if (status === 'scheduled' && startDate?.day === undefined) {
    problems.push({ path: `${at}/startDate`, detail: 'a scheduled event has a complete startDate' });
  }
  if (status === 'postponed' && (startDate || hasTime)) {
    problems.push({ path: `${at}/startDate`, detail: 'a postponed event has no current date nor time; the previous ones stay in its revisions' });
  }
  return problems;
}

// Tours

const TOUR_CREATION: OperationDefinition = {
  entityType: 'tour',
  operation: 'create_entity',
  targetPath: 'tours',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de un tour: título y estado (`announced`, `scheduled`, `in_progress`, `postponed`, `cancelled` o `completed`). ' +
    'Inicio y fin anunciados son fechas parciales opcionales; sus países y fechas se derivan de sus conciertos publicados.',
  valueSchema: TOUR,
  targetKeySchema: null,
  check: (value) => checkTourSchedule(value as TourValue, '/value'),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedTour(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  apply: async (manager, root, value, now) => {
    const tour = await createTour(manager, root.id, value as TourValue, now);
    const { value: created } = (await findCreatedTour(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: tour.id, publicId: tour.publicId } };
  },
};

const TOUR_FIELD_RULES: Record<TourFieldPath, { description: string; schema: object }> = {
  'tours.title': { description: 'Título del tour.', schema: TITLE },
  'tours.description': { description: 'Descripción del tour, o null.', schema: DESCRIPTION },
  'tours.image_url': { description: 'URL HTTP(S) de la imagen del tour, o null.', schema: IMAGE_URL },
  'tours.schedule': {
    description: 'Estado de negocio con el inicio y el fin anunciados, que cambian juntos. Nunca cambia el estado de sus conciertos.',
    schema: TOUR_SCHEDULE,
  },
};

const TOUR_FIELD_CHANGES: OperationDefinition[] = (Object.keys(TOUR_FIELDS) as TourFieldPath[]).map((path) => ({
  entityType: 'tour',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: TOUR_FIELD_RULES[path].description,
  valueSchema: TOUR_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'tours.schedule' ? checkTourSchedule(value as TourScheduleValue, '/value') : []),
  ...noReferences,
  read: async (manager, root) => {
    const created = await findCreatedTour(manager, root.id);
    return created ? envelope(tourFieldValue(created.value, path)) : ABSENT;
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeTourField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

// Events

const EVENT_CREATION: OperationDefinition = {
  entityType: 'event',
  operation: 'create_entity',
  targetPath: 'events',
  payloadSchemaVersion: 1,
  description:
    'Alta mínima de un concierto: título y estado (`announced`, `scheduled`, `postponed`, `cancelled` o `performed`). Fecha ' +
    'parcial, hora local con fecha completa y zona IANA, país, ciudad, recinto y tour (publicado o creado en la misma propuesta) ' +
    'son opcionales. Dos conciertos en el mismo recinto y fecha pueden ser distintos.',
  valueSchema: EVENT,
  targetKeySchema: null,
  check: (value) => checkEventSchedule(value as EventValue, '/value'),
  references: (value) => countryReference((value as EventValue).countryId, '/value/countryId'),
  rootReferences: (value) => namedTour((value as EventValue).tour, '/value/tour/entity_id'),
  read: async (manager, root) => {
    const created = await findCreatedEvent(manager, root.id);
    return created ? { exists: true, value: { ...created.value } as never } : ABSENT;
  },
  apply: async (manager, root, value, now) => {
    const event = await createEvent(manager, root.id, value as EventValue, now);
    const { value: created } = (await findCreatedEvent(manager, root.id))!;
    return { afterValue: { exists: true, value: { ...created } as never }, resultKey: { id: event.id, publicId: event.publicId } };
  },
};

const EVENT_FIELD_RULES: Record<EventFieldPath, { description: string; schema: object }> = {
  'events.title': { description: 'Título del concierto.', schema: TITLE },
  'events.description': { description: 'Descripción del concierto, o null.', schema: DESCRIPTION },
  'events.image_url': { description: 'URL HTTP(S) de la imagen del concierto, o null.', schema: IMAGE_URL },
  'events.tour': { description: 'Tour al que pertenece el concierto, publicado o creado en la misma propuesta, o null.', schema: TOUR_REFERENCE },
  'events.schedule': {
    description:
      'Estado de negocio con la fecha parcial, la hora local y la zona IANA, que cambian juntos. Aplazar borra la fecha vigente ' +
      '(las anteriores quedan en las revisiones); cancelar conserva la última conocida.',
    schema: EVENT_SCHEDULE,
  },
  'events.location': { description: 'País, ciudad y recinto del concierto; cada uno puede ser null si se desconoce.', schema: EVENT_LOCATION },
};

const EVENT_FIELD_CHANGES: OperationDefinition[] = (Object.keys(EVENT_FIELDS) as EventFieldPath[]).map((path) => ({
  entityType: 'event',
  operation: 'set_fields',
  targetPath: path,
  payloadSchemaVersion: 1,
  description: EVENT_FIELD_RULES[path].description,
  valueSchema: EVENT_FIELD_RULES[path].schema,
  targetKeySchema: null,
  check: (value) => (path === 'events.schedule' ? checkEventSchedule(value as EventScheduleValue, '/value') : []),
  references: (value) => (path === 'events.location' ? countryReference((value as EventLocationValue).countryId, '/value/countryId') : []),
  ...(path === 'events.tour' ? { rootReferences: (value: unknown) => namedTour(value as RootReference | null, '/value/entity_id') } : {}),
  read: async (manager, root) => {
    const created = await findCreatedEvent(manager, root.id);
    return created ? envelope(eventFieldValue(created.value, path)) : ABSENT;
  },
  apply: async (manager: EntityManager, root: EditorialEntity, value, now) => ({
    afterValue: envelope(await writeEventField(manager, root.id, path, value, now)),
    resultKey: null,
  }),
}));

// Artists, organizers and links of either root

const ownerIdOf = (root: LiveRoot) => (root === 'tour' ? tourIdOf : eventIdOf);
const noun = (root: LiveRoot) => (root === 'tour' ? 'el tour' : 'el concierto');

/** Add, update and remove operations on the announced artists of a root. */
function artistChanges(root: LiveRoot): OperationDefinition[] {
  const KEY = {
    type: 'object',
    additionalProperties: false,
    required: [`${root}_id`, 'artist_id'],
    properties: {
      [`${root}_id`]: reference('entity_id', `Raíz editorial de ${noun(root)}: la del microcambio`),
      artist_id: reference('entity_id', 'Raíz editorial de la identidad del artista: publicada, o creada en la misma propuesta, con perfil artístico'),
    },
  };
  const VALUE = {
    type: 'object',
    additionalProperties: false,
    required: ['role', 'position'],
    properties: {
      role: { enum: LIVE_ARTIST_ROLES, description: 'main, support o guest' },
      position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden editorial' },
      creditedAs: { type: ['string', 'null'], maxLength: 200, pattern: '\\S', description: 'Nombre anunciado literal; null muestra el nombre visible' },
    },
  };
  const read = async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const row = key && (await findLiveArtist(manager, root, key[`${root}_id`], key.artist_id));
    return row ? { exists: true, value: { ...row } } : ABSENT;
  };
  const base = {
    entityType: root,
    targetPath: `${root}_artists`,
    payloadSchemaVersion: 1,
    targetKeySchema: KEY,
    keyRoots: { artist_id: { entityType: 'identity', idOf: artistIdOfIdentity } },
    check: () => [],
    references: () => [],
    read,
  } satisfies Partial<OperationDefinition>;
  const write = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
    ...base,
    operation,
    description,
    valueSchema: VALUE,
    targetProblems: (manager, _root, _value, targetKey) => artistProblems(manager, targetKey),
    constraintProblems: async (manager, entity, key) =>
      operation === 'update_relation' && !(await read(manager, entity, key)).exists ? ['El artista ya no está anunciado'] : [],
    apply: async (manager, entity, value, now, key) => {
      await writeLiveArtist(manager, root, key![`${root}_id`], key!.artist_id, value as LiveArtistValue, now);
      return { afterValue: await read(manager, entity, key), resultKey: key };
    },
  });
  return [
    write('add_relation', `Anuncia a un artista en ${noun(root)} con su rol y posición. Su clave es ${noun(root)} y la identidad del artista.`),
    write('update_relation', `Cambia el rol, la posición o el nombre anunciado de un artista de ${noun(root)}.`),
    {
      ...base,
      operation: 'remove_relation',
      description: `Quita un artista de ${noun(root)}; la revisión guarda sus valores anteriores.`,
      valueSchema: null,
      apply: async (manager, _entity, _value, now, key) => {
        await deleteLiveArtist(manager, root, key![`${root}_id`], key!.artist_id, now);
        return { afterValue: ABSENT, resultKey: key };
      },
    },
  ];
}

/** The identity a key names has an artist profile, once it is created: a reservation's is checked after its creation applies. */
async function artistProblems(manager: EntityManager, targetKey: object | null): Promise<TargetProblem[]> {
  const identity = (targetKey as { artist_id: { entity_id: string } }).artist_id.entity_id;
  const identityId = await identityIdOf(manager, identity.toLowerCase());
  if (identityId === null || (await hasArtist(manager, identityId))) return [];
  return [{ code: 'no_artist_profile', detail: 'Only an identity with an artist profile is announced as an artist', member: 'targetKey/artist_id' }];
}

/** Add, update and remove operations on the organizers of a root. */
function organizerChanges(root: LiveRoot): OperationDefinition[] {
  const KEY = {
    type: 'object',
    additionalProperties: false,
    required: [`${root}_id`, 'catalog_identity_id'],
    properties: {
      [`${root}_id`]: reference('entity_id', `Raíz editorial de ${noun(root)}: la del microcambio`),
      catalog_identity_id: reference('entity_id', 'Raíz editorial de la persona u organización organizadora: publicada, o creada en la misma propuesta'),
    },
  };
  const VALUE = {
    type: 'object',
    additionalProperties: false,
    required: ['position'],
    properties: {
      position: { type: 'integer', minimum: 0, maximum: 32767, description: 'Orden editorial' },
      details: { type: ['string', 'null'], maxLength: 10000, description: 'Qué organiza, como promotora local' },
    },
  };
  const read = async (manager: EntityManager, _root: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const row = key && (await findOrganizer(manager, root, key[`${root}_id`], key.catalog_identity_id));
    return row ? { exists: true, value: { ...row } } : ABSENT;
  };
  const base = {
    entityType: root,
    targetPath: `${root}_organizers`,
    payloadSchemaVersion: 1,
    targetKeySchema: KEY,
    keyRoots: { catalog_identity_id: { entityType: 'identity', idOf: identityIdOf } },
    check: () => [],
    references: () => [],
    read,
  } satisfies Partial<OperationDefinition>;
  const write = (operation: 'add_relation' | 'update_relation', description: string): OperationDefinition => ({
    ...base,
    operation,
    description,
    valueSchema: VALUE,
    constraintProblems: async (manager, entity, key) =>
      operation === 'update_relation' && !(await read(manager, entity, key)).exists ? ['La organización ya no figura'] : [],
    apply: async (manager, entity, value, now, key) => {
      await writeOrganizer(manager, root, key![`${root}_id`], key!.catalog_identity_id, value as OrganizerValue, now);
      return { afterValue: await read(manager, entity, key), resultKey: key };
    },
  });
  return [
    write('add_relation', `Acredita a una persona u organización como organizadora de ${noun(root)}, sin crear otra identidad.`),
    write('update_relation', `Cambia la posición o los detalles de una organizadora de ${noun(root)}.`),
    {
      ...base,
      operation: 'remove_relation',
      description: `Quita una organizadora de ${noun(root)}; la revisión guarda sus valores anteriores.`,
      valueSchema: null,
      apply: async (manager, _entity, _value, now, key) => {
        await deleteOrganizer(manager, root, key![`${root}_id`], key!.catalog_identity_id, now);
        return { afterValue: ABSENT, resultKey: key };
      },
    },
  ];
}

/** Add, update and remove operations on the official and ticket links of a root. */
function linkChanges(root: LiveRoot): OperationDefinition[] {
  const VALUE = {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'url', 'purpose', 'position'],
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
      url: { type: 'string', maxLength: 2048, pattern: '^[Hh][Tt][Tt][Pp][Ss]?://\\S+$' },
      purpose: { enum: LINK_PURPOSES, description: 'official o tickets: una página externa, nunca una venta propia' },
      position: { type: 'integer', minimum: 0, maximum: 32767 },
      ...(root === 'tour' ? { countryId: { ...COUNTRY_ID, description: 'id del país de la página en /v1/countries; null para la general' } } : {}),
    },
  };
  const ownerOf = async (manager: EntityManager, entity: EditorialEntity) => (await ownerIdOf(root)(manager, entity.id))!;
  const read = async (manager: EntityManager, entity: EditorialEntity, key: RowKey | null): Promise<ValueEnvelope> => {
    const ownerId = await ownerIdOf(root)(manager, entity.id);
    return ownerId === null || key === null ? ABSENT : rowEnvelope(await findLink(manager, root, ownerId, key.id));
  };
  const base = {
    entityType: root,
    targetPath: `${root}_links`,
    payloadSchemaVersion: 1,
    check: () => [],
  } satisfies Partial<OperationDefinition>;
  const references = (value: unknown) => countryReference((value as LinkValue).countryId, '/value/countryId');
  const unique = root === 'tour' ? 'URL y país' : 'URL';
  return [
    {
      ...base,
      operation: 'add_relation',
      description: `Añade un enlace HTTP(S) oficial o de entradas a ${noun(root)}. Su ${unique} es único en ${noun(root)}.`,
      valueSchema: VALUE,
      targetKeySchema: null,
      references,
      naturalKey: (value) => {
        const { url, countryId } = (value ?? {}) as Partial<LinkValue>;
        if (typeof url !== 'string') return undefined;
        return root === 'tour' ? { url, countryId: countryId ?? null } : { url };
      },
      read: async (manager, entity, _key, value) => {
        const ownerId = await ownerIdOf(root)(manager, entity.id);
        return ownerId === null ? ABSENT : rowEnvelope(await findLinkByUniqueKey(manager, root, ownerId, value as LinkValue));
      },
      constraintProblems: async (manager, entity, _key, value) => linkClashes(manager, root, await ownerOf(manager, entity), value as LinkValue, null),
      apply: async (manager, entity, value, now) => {
        const ownerId = await ownerOf(manager, entity);
        const id = await insertLink(manager, root, ownerId, value as LinkValue, now);
        return { afterValue: rowEnvelope(await findLink(manager, root, ownerId, id)), resultKey: { id } };
      },
    },
    {
      ...base,
      operation: 'update_relation',
      description: `Sustituye los datos de un enlace existente de ${noun(root)}.`,
      valueSchema: VALUE,
      targetKeySchema: ROW_KEY,
      references,
      read,
      constraintProblems: async (manager, entity, key, value) => {
        const ownerId = await ownerOf(manager, entity);
        if (!(await findLink(manager, root, ownerId, key!.id))) return ['El enlace ya no existe'];
        return linkClashes(manager, root, ownerId, value as LinkValue, key!.id);
      },
      apply: async (manager, entity, value, now, key) => {
        const ownerId = await ownerOf(manager, entity);
        await updateLink(manager, root, ownerId, key!.id, value as LinkValue, now);
        return { afterValue: rowEnvelope(await findLink(manager, root, ownerId, key!.id)), resultKey: key };
      },
    },
    {
      ...base,
      operation: 'remove_relation',
      description: `Quita un enlace de ${noun(root)}; la revisión guarda sus valores anteriores.`,
      valueSchema: null,
      targetKeySchema: ROW_KEY,
      references: () => [],
      read,
      apply: async (manager, entity, _value, now, key) => {
        await deleteLink(manager, root, await ownerOf(manager, entity), key!.id, now);
        return { afterValue: ABSENT, resultKey: key };
      },
    },
  ];
}

export const TOUR_CHANGES: OperationDefinition[] = [
  TOUR_CREATION,
  ...TOUR_FIELD_CHANGES,
  ...artistChanges('tour'),
  ...organizerChanges('tour'),
  ...linkChanges('tour'),
];

export const EVENT_CHANGES: OperationDefinition[] = [
  EVENT_CREATION,
  ...EVENT_FIELD_CHANGES,
  ...artistChanges('event'),
  ...organizerChanges('event'),
  ...linkChanges('event'),
];
