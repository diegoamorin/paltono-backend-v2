import { randomUUID } from 'node:crypto';
import { EntityManager, Not } from 'typeorm';
import {
  PartialDateValue,
  partialDateColumns,
  partialDateInterval,
  partialDateLookup,
  partialDateValue,
  samePartialDate,
} from '../common/partial-date/partial-date';
import {
  AffiliationRelationshipType,
  Artist,
  ArtistOrganizationAffiliation,
  AssociationStatus,
  OrganizationMembership,
  OrganizationMembershipRole,
} from './entities/artist.entity';
import { CatalogIdentity } from './entities/catalog-identity.entity';
import { newPublicId } from './identity-creations';

/*
 * The reads and writes of the artist profile of an identity, the memberships
 * of an organization with their roles and the affiliations of an artist,
 * which this module owns. The editorial flow calls them inside the
 * transaction that applies a relation change, once it holds the locks of
 * every identity involved. Another identity is named by its editorial UUID,
 * as `{"entity_id": …}`, since its domain ids are not public.
 */

export interface RootReference {
  entity_id: string;
}

export interface MembershipRoleValue {
  contributionRoleId: number;
  position: number;
  details: string | null;
}

/** A membership as relation changes propose it and revisions record it, with its roles in order. */
export interface MembershipValue {
  member: RootReference;
  joined: PartialDateValue | null;
  left: PartialDateValue | null;
  status: AssociationStatus;
  description: string | null;
  sourceText: string | null;
  sourceUrl: string | null;
  roles: MembershipRoleValue[];
}

/** An affiliation as relation changes propose it and revisions record it. */
export interface AffiliationValue {
  organization: RootReference;
  relationshipType: AffiliationRelationshipType;
  startedAt: PartialDateValue | null;
  endedAt: PartialDateValue | null;
  status: AssociationStatus;
  description: string | null;
}

// Artist profiles

export function hasArtist(manager: EntityManager, catalogIdentityId: number): Promise<boolean> {
  return manager.existsBy(Artist, { catalogIdentityId });
}

export async function artistIdOf(manager: EntityManager, catalogIdentityId: number): Promise<number | null> {
  const artist = await manager.findOne(Artist, { select: { id: true }, where: { catalogIdentityId } });
  return artist?.id ?? null;
}

/** What keeps the artist profile of an identity from being removed: its debut and what still refers to it. */
export async function artistReferences(manager: EntityManager, catalogIdentityId: number): Promise<string[]> {
  const artistId = await artistIdOf(manager, catalogIdentityId);
  if (artistId === null) return [];
  const references: string[] = [];
  // Emptying it first keeps the date in the history: a removal's revision records the profile without data.
  if (await findDebut(manager, catalogIdentityId)) references.push('El perfil artístico tiene debut; vacíalo antes de quitar el perfil');
  if (await manager.existsBy(ArtistOrganizationAffiliation, { artistId })) {
    references.push('El perfil artístico tiene afiliaciones; quítalas antes de quitar el perfil');
  }
  // Presentation credits belong to the music module, whose release groups and releases own them.
  const [{ credited, onTracks }] = await manager.query(
    `SELECT EXISTS (SELECT 1 FROM release_artist_credits WHERE artist_id = $1) AS credited,
            EXISTS (SELECT 1 FROM track_artist_credits WHERE artist_id = $1) AS "onTracks"`,
    [artistId],
  );
  if (credited) references.push('El perfil artístico tiene créditos de presentación en lanzamientos; quítalos antes de quitar el perfil');
  if (onTracks) references.push('El perfil artístico tiene créditos de presentación en pistas; quítalos antes de quitar el perfil');
  // Tours and events belong to the live-events module, whose roots own their announced artists.
  const [{ announced }] = await manager.query(
    'SELECT EXISTS (SELECT 1 FROM tour_artists WHERE artist_id = $1) OR EXISTS (SELECT 1 FROM event_artists WHERE artist_id = $1) AS announced',
    [artistId],
  );
  if (announced) references.push('El perfil artístico está anunciado en tours o conciertos; quítalo de ellos antes de quitar el perfil');
  return references;
}

export async function insertArtist(manager: EntityManager, catalogIdentityId: number, now: Date): Promise<void> {
  await manager.insert(Artist, { uuid: randomUUID(), publicId: newPublicId(), catalogIdentityId, createdAt: now, updatedAt: now });
  await touchIdentity(manager, catalogIdentityId, now);
}

export async function deleteArtist(manager: EntityManager, catalogIdentityId: number, now: Date): Promise<void> {
  await manager.delete(Artist, { catalogIdentityId });
  await touchIdentity(manager, catalogIdentityId, now);
}

/** The debut of an identity's artist profile; an identity without one has none. */
export async function findDebut(manager: EntityManager, catalogIdentityId: number): Promise<PartialDateValue | null> {
  const artist = await manager.findOneBy(Artist, { catalogIdentityId });
  return artist && partialDateValue(artist, 'debut');
}

export async function writeDebut(manager: EntityManager, catalogIdentityId: number, debut: PartialDateValue | null, now: Date): Promise<void> {
  await manager.update(Artist, { catalogIdentityId }, { ...partialDateColumns('debut', debut), updatedAt: now });
  await touchIdentity(manager, catalogIdentityId, now);
}

// Memberships

export async function findMembership(manager: EntityManager, organizationId: number, id: number): Promise<MembershipValue | null> {
  const row = await manager.findOne(OrganizationMembership, { where: { organizationId, id }, relations: { member: true } });
  return row && membershipValue(manager, row);
}

/** The membership of a member that starts on the given date, which the uniqueness of their period makes unambiguous. */
export async function findMembershipByStart(
  manager: EntityManager,
  organizationId: number,
  memberIdentityId: number,
  joined: PartialDateValue | null,
): Promise<MembershipValue | null> {
  const row = await manager.findOne(OrganizationMembership, {
    where: { organizationId, memberIdentityId, ...partialDateLookup('joined', joined) },
    relations: { member: true },
  });
  return row && membershipValue(manager, row);
}

/**
 * What a membership of an organization would break, besides the row it
 * replaces: the uniqueness of its start, a second current membership of the
 * same member, a period that certainly overlaps another one of the same
 * member, and a cycle of organizations that are members of each other.
 */
export async function membershipClashes(
  manager: EntityManager,
  organizationId: number,
  memberIdentityId: number,
  value: MembershipValue,
  replacedId: number | null,
): Promise<string[]> {
  const others = await manager.findBy(OrganizationMembership, {
    organizationId,
    memberIdentityId,
    ...(replacedId === null ? {} : { id: Not(replacedId) }),
  });
  const clashes: string[] = [];
  if (others.some((row) => samePartialDate(partialDateValue(row, 'joined'), value.joined))) {
    clashes.push('El miembro ya tiene una membresía con esa fecha de entrada');
  } else if (value.status === 'current' && others.some((row) => row.status === 'current')) {
    clashes.push('El miembro ya tiene una membresía actual en esta organización');
  } else if (others.some((row) => certainlyOverlap(period(value), period(rowPeriod(row))))) {
    clashes.push('El periodo se solapa con certeza con otra membresía del mismo miembro');
  }
  const [{ cycle }] = await manager.query(
    `WITH RECURSIVE reached(id) AS (
       SELECT $1::integer
       UNION
       SELECT membership.member_identity_id FROM organization_memberships membership JOIN reached ON membership.organization_id = reached.id
     )
     SELECT EXISTS (SELECT 1 FROM reached WHERE id = $2) AS cycle`,
    [memberIdentityId, organizationId],
  );
  if (cycle) clashes.push('La membresía formaría un ciclo de organizaciones que son miembros entre sí');
  return clashes;
}

export async function insertMembership(
  manager: EntityManager,
  organizationId: number,
  memberIdentityId: number,
  value: MembershipValue,
  now: Date,
): Promise<number> {
  const { identifiers } = await manager.insert(OrganizationMembership, {
    organizationId,
    memberIdentityId,
    ...membershipColumns(value),
    createdAt: now,
    updatedAt: now,
  });
  const id = identifiers[0].id as number;
  await insertRoles(manager, id, value.roles, now);
  await touchIdentity(manager, organizationId, now);
  return id;
}

export async function updateMembership(
  manager: EntityManager,
  organizationId: number,
  id: number,
  memberIdentityId: number,
  value: MembershipValue,
  now: Date,
): Promise<void> {
  await manager.delete(OrganizationMembershipRole, { organizationMembershipId: id });
  await manager.update(OrganizationMembership, { organizationId, id }, { memberIdentityId, ...membershipColumns(value), updatedAt: now });
  await insertRoles(manager, id, value.roles, now);
  await touchIdentity(manager, organizationId, now);
}

/** Removes a membership with its roles, which are part of it. */
export async function deleteMembership(manager: EntityManager, organizationId: number, id: number, now: Date): Promise<void> {
  await manager.delete(OrganizationMembershipRole, { organizationMembershipId: id });
  await manager.delete(OrganizationMembership, { organizationId, id });
  await touchIdentity(manager, organizationId, now);
}

async function insertRoles(manager: EntityManager, organizationMembershipId: number, roles: MembershipRoleValue[], now: Date): Promise<void> {
  if (roles.length === 0) return;
  await manager.insert(
    OrganizationMembershipRole,
    roles.map((role) => ({ organizationMembershipId, ...role, roleScope: 'membership' as const, createdAt: now, updatedAt: now })),
  );
}

async function membershipValue(manager: EntityManager, row: OrganizationMembership): Promise<MembershipValue> {
  const roles = await manager.find(OrganizationMembershipRole, {
    where: { organizationMembershipId: row.id },
    order: { position: 'ASC', contributionRoleId: 'ASC' },
  });
  return {
    member: { entity_id: row.member!.editorialEntityId },
    joined: partialDateValue(row, 'joined'),
    left: partialDateValue(row, 'left'),
    status: row.status,
    description: row.description,
    sourceText: row.sourceText,
    sourceUrl: row.sourceUrl,
    roles: roles.map(({ contributionRoleId, position, details }) => ({ contributionRoleId, position, details })),
  };
}

function membershipColumns(value: MembershipValue) {
  return {
    ...partialDateColumns('joined', value.joined),
    ...partialDateColumns('left', value.left),
    status: value.status,
    description: value.description,
    sourceText: value.sourceText,
    sourceUrl: value.sourceUrl,
  };
}

// Affiliations

export async function findAffiliation(manager: EntityManager, artistId: number, id: number): Promise<AffiliationValue | null> {
  const row = await manager.findOne(ArtistOrganizationAffiliation, { where: { artistId, id }, relations: { organization: { catalogIdentity: true } } });
  return row && affiliationValue(row);
}

/** The affiliation with the given organization, type and start, which their uniqueness makes unambiguous. */
export async function findAffiliationByStart(
  manager: EntityManager,
  artistId: number,
  organizationId: number,
  value: Pick<AffiliationValue, 'relationshipType' | 'startedAt'>,
): Promise<AffiliationValue | null> {
  const row = await manager.findOne(ArtistOrganizationAffiliation, {
    where: { artistId, organizationId, relationshipType: value.relationshipType, ...partialDateLookup('started', value.startedAt) },
    relations: { organization: { catalogIdentity: true } },
  });
  return row && affiliationValue(row);
}

/** What an affiliation of an artist would break, besides the row it replaces: the uniqueness of its organization, type and start. */
export async function affiliationClashes(
  manager: EntityManager,
  artistId: number,
  organizationId: number,
  value: AffiliationValue,
  replacedId: number | null,
): Promise<string[]> {
  const clash = await manager.existsBy(ArtistOrganizationAffiliation, {
    artistId,
    organizationId,
    relationshipType: value.relationshipType,
    ...partialDateLookup('started', value.startedAt),
    ...(replacedId === null ? {} : { id: Not(replacedId) }),
  });
  return clash ? ['El artista ya tiene esa afiliación con la organización desde esa fecha'] : [];
}

export async function insertAffiliation(
  manager: EntityManager,
  artistId: number,
  organizationId: number,
  value: AffiliationValue,
  now: Date,
): Promise<number> {
  const { identifiers } = await manager.insert(ArtistOrganizationAffiliation, {
    artistId,
    organizationId,
    ...affiliationColumns(value),
    createdAt: now,
    updatedAt: now,
  });
  await touchArtist(manager, artistId, now);
  return identifiers[0].id as number;
}

export async function updateAffiliation(
  manager: EntityManager,
  artistId: number,
  id: number,
  organizationId: number,
  value: AffiliationValue,
  now: Date,
): Promise<void> {
  await manager.update(ArtistOrganizationAffiliation, { artistId, id }, { organizationId, ...affiliationColumns(value), updatedAt: now });
  await touchArtist(manager, artistId, now);
}

export async function deleteAffiliation(manager: EntityManager, artistId: number, id: number, now: Date): Promise<void> {
  await manager.delete(ArtistOrganizationAffiliation, { artistId, id });
  await touchArtist(manager, artistId, now);
}

function affiliationValue(row: ArtistOrganizationAffiliation): AffiliationValue {
  return {
    organization: { entity_id: row.organization!.catalogIdentity!.editorialEntityId },
    relationshipType: row.relationshipType,
    startedAt: partialDateValue(row, 'started'),
    endedAt: partialDateValue(row, 'ended'),
    status: row.status,
    description: row.description,
  };
}

function affiliationColumns(value: AffiliationValue) {
  const { relationshipType, startedAt, endedAt, status, description } = value;
  return { relationshipType, ...partialDateColumns('started', startedAt), ...partialDateColumns('ended', endedAt), status, description };
}

// Periods

function rowPeriod(row: OrganizationMembership): Pick<MembershipValue, 'joined' | 'left' | 'status'> {
  return {
    joined: partialDateValue(row, 'joined'),
    left: partialDateValue(row, 'left'),
    status: row.status,
  };
}

/** Today, after any date a partial date can hold. */
const NOW = 99_999_999;

/**
 * The latest day a membership may have started and the earliest it may have
 * ended. A current membership surely includes today, whenever it started; an
 * unknown start or departure of a past one may have been at any time.
 */
function period({ joined, left, status }: Pick<MembershipValue, 'joined' | 'left' | 'status'>): { latestStart: number; earliestEnd: number } {
  if (status === 'current') return { latestStart: joined ? partialDateInterval(joined).last : NOW, earliestEnd: NOW + 1 };
  return { latestStart: joined ? partialDateInterval(joined).last : Infinity, earliestEnd: left ? partialDateInterval(left).first : -Infinity };
}

/** Two periods overlap for certain when both had certainly started before either could have ended. */
function certainlyOverlap(a: ReturnType<typeof period>, b: ReturnType<typeof period>): boolean {
  return Math.max(a.latestStart, b.latestStart) < Math.min(a.earliestEnd, b.earliestEnd);
}

async function touchIdentity(manager: EntityManager, id: number, now: Date): Promise<void> {
  await manager.update(CatalogIdentity, { id }, { updatedAt: now });
}

async function touchArtist(manager: EntityManager, id: number, now: Date): Promise<void> {
  await manager.update(Artist, { id }, { updatedAt: now });
  const artist = await manager.findOneByOrFail(Artist, { id });
  await touchIdentity(manager, artist.catalogIdentityId, now);
}
