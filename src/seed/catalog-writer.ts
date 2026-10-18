import { User } from '../accounts/entities/user.entity';
import { PartialDateValue } from '../catalog-identities/identity-creations';
import { EditorialSeeder, SeedChange } from './editorial-seeder';
import { CountryCode, GenreSlug, OrganizationTypeSlug, PlatformSlug, RoleSlug, SeedVocabularies } from './seed-vocabularies';

/*
 * Turns the seed's catalog descriptions into microchanges: each entry is the
 * minimal creation of its root followed by the relation changes that complete
 * it. A reservation only accepts relations keyed by itself, so the rest wait
 * for a second proposal, once the creations are published.
 */

export type Status = 'current' | 'former' | 'unknown';

export interface AffiliationSpec {
  /** Key of a published organization, or of one in the same submission. */
  organization: string;
  type: 'agency' | 'label' | 'management';
  status: Status;
  startedAt?: string;
  endedAt?: string;
}

interface IdentitySpec {
  /** How other entries of the seed refer to this one. */
  key: string;
  displayName: string;
  bio?: string;
  /** Other spellings, such as the name in hangul; the first is the primary alias. */
  aliases?: string[];
  /** Becomes an artist. */
  artist?: boolean;
  affiliations?: AffiliationSpec[];
  links?: Partial<Record<PlatformSlug, string>>;
}

export interface PersonSpec extends IdentitySpec {
  givenName?: string;
  familyName?: string;
  birthDate?: string;
  deathDate?: string;
  gender?: 'male' | 'female';
  nationalities?: CountryCode[];
}

export interface MemberSpec {
  member: string;
  joined?: PartialDateValue;
  left?: PartialDateValue;
  status: Status;
  roles?: RoleSlug[];
}

export interface OrganizationSpec extends IdentitySpec {
  founding?: PartialDateValue;
  dissolution?: PartialDateValue;
  originCountry?: CountryCode;
  types: OrganizationTypeSlug[];
  members?: MemberSpec[];
  /** Where the membership data comes from, kept on each membership. */
  membershipSource?: string;
}

export interface CreditSpec {
  identity: string;
  role: RoleSlug;
}

export interface WorkSpec {
  key: string;
  title: string;
  description?: string;
  credits?: CreditSpec[];
}

export interface RecordingSpec {
  key: string;
  title: string;
  description?: string;
  recordingDate?: PartialDateValue;
  /** The first is the primary genre. */
  genres?: GenreSlug[];
  credits?: CreditSpec[];
  works: { work: string; relationType: 'performance' | 'interpolation' | 'sample' }[];
}

/** One proposal of the seed: what it describes, why, its sources and who sends it. */
export interface Submission {
  description: string;
  sources: string[];
  organizations?: OrganizationSpec[];
  people?: PersonSpec[];
  /** Memberships added to organizations published by earlier submissions, such as a group's subunit. */
  memberships?: { organization: string; members: MemberSpec[]; source: string }[];
  works?: WorkSpec[];
  recordings?: RecordingSpec[];
}

const entity = (entityId: string) => ({ entity_id: entityId });

/** The microchanges of a submission, in the two proposals it becomes. */
interface Plan {
  /** Creations, with the relations keyed by their own root, which a reservation accepts. */
  creations: SeedChange[];
  /** Relations keyed by a generated id, which only a published root accepts: aliases, links, affiliations, memberships, credits. */
  completions: SeedChange[];
}

export class CatalogWriter {
  /** The editorial root of each entry, by its key. */
  private readonly roots = new Map<string, string>();

  constructor(
    private readonly seeder: EditorialSeeder,
    private readonly vocabularies: SeedVocabularies,
  ) {}

  /**
   * Writes a submission as the proposals of `author`: one that creates its
   * entries and, once they are published, one that completes them.
   */
  async write(author: User, submission: Submission): Promise<void> {
    const plan: Plan = { creations: [], completions: [] };
    const { organizations = [], people = [], memberships = [], works = [], recordings = [] } = submission;

    for (const organization of organizations) await this.planOrganization(author, plan, organization);
    for (const person of people) await this.planPerson(author, plan, person);
    for (const identity of [...organizations, ...people]) {
      for (const affiliation of identity.affiliations ?? []) plan.completions.push(this.affiliation(identity.key, affiliation));
    }
    for (const organization of organizations) {
      for (const member of organization.members ?? []) plan.completions.push(this.membership(organization.key, member, organization.membershipSource));
    }
    for (const { organization, members, source } of memberships) {
      for (const member of members) plan.completions.push(this.membership(organization, member, source));
    }
    for (const work of works) await this.planWork(author, plan, work);
    for (const recording of recordings) await this.planRecording(author, plan, recording);

    const { description, sources } = submission;
    if (plan.creations.length > 0) await this.seeder.propose({ author, description, sources, changes: plan.creations });
    if (plan.completions.length > 0) {
      const completion = plan.creations.length > 0 ? `${description}: alias, enlaces, afiliaciones, membresías y créditos` : description;
      await this.seeder.propose({ author, description: completion, sources, changes: plan.completions });
    }
  }

  private root(key: string): string {
    const id = this.roots.get(key);
    if (!id) throw new Error(`The seed refers to "${key}" before creating it`);
    return id;
  }

  private async reserve(author: User, key: string, type: 'identity' | 'work' | 'recording'): Promise<string> {
    if (this.roots.has(key)) throw new Error(`The seed creates "${key}" twice`);
    const id = await this.seeder.reserve(author, type);
    this.roots.set(key, id);
    return id;
  }

  private async planPerson(author: User, plan: Plan, spec: PersonSpec): Promise<void> {
    const id = await this.reserve(author, spec.key, 'identity');
    plan.creations.push({
      entityId: id,
      operation: 'create_entity',
      targetPath: 'catalog_identities',
      value: {
        type: 'person',
        displayName: spec.displayName,
        bio: spec.bio ?? null,
        person: {
          givenName: spec.givenName ?? null,
          familyName: spec.familyName ?? null,
          birthDate: spec.birthDate ?? null,
          deathDate: spec.deathDate ?? null,
          gender: spec.gender ?? null,
        },
      },
    });
    for (const code of spec.nationalities ?? []) {
      plan.creations.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'person_nationalities',
        targetKey: { person_id: entity(id), country_id: this.vocabularies.countries[code] },
        value: {},
      });
    }
    this.planIdentity(plan, id, spec);
  }

  private async planOrganization(author: User, plan: Plan, spec: OrganizationSpec): Promise<void> {
    const id = await this.reserve(author, spec.key, 'identity');
    plan.creations.push({
      entityId: id,
      operation: 'create_entity',
      targetPath: 'catalog_identities',
      value: {
        type: 'organization',
        displayName: spec.displayName,
        bio: spec.bio ?? null,
        organization: {
          founding: spec.founding ?? null,
          dissolution: spec.dissolution ?? null,
          originCountryId: spec.originCountry ? this.vocabularies.countries[spec.originCountry] : null,
        },
      },
    });
    for (const type of spec.types) {
      plan.creations.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'organization_type_assignments',
        targetKey: { organization_id: entity(id), organization_type_id: this.vocabularies.organizationTypes[type] },
        value: {},
      });
    }
    this.planIdentity(plan, id, spec);
  }

  /** The artist profile, aliases and platform links, common to people and organizations. */
  private planIdentity(plan: Plan, id: string, spec: IdentitySpec): void {
    if (spec.artist) {
      plan.creations.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'artists',
        targetKey: { catalog_identity_id: entity(id) },
        value: {},
      });
    }
    for (const [index, alias] of (spec.aliases ?? []).entries()) {
      plan.completions.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'catalog_identity_aliases',
        value: { alias, isPrimary: index === 0, sortOrder: index },
      });
    }
    for (const [platform, url] of Object.entries(spec.links ?? {}) as [PlatformSlug, string][]) {
      plan.completions.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'catalog_identity_platform_links',
        value: { platformId: this.vocabularies.platforms[platform], url },
      });
    }
  }

  private affiliation(artist: string, spec: AffiliationSpec): SeedChange {
    return {
      entityId: this.root(artist),
      operation: 'add_relation',
      targetPath: 'artist_organization_affiliations',
      value: {
        organization: entity(this.root(spec.organization)),
        relationshipType: spec.type,
        startedAt: spec.startedAt ?? null,
        endedAt: spec.endedAt ?? null,
        status: spec.status,
        description: null,
      },
    };
  }

  private membership(organization: string, spec: MemberSpec, source: string | undefined): SeedChange {
    return {
      entityId: this.root(organization),
      operation: 'add_relation',
      targetPath: 'organization_memberships',
      value: {
        member: entity(this.root(spec.member)),
        joined: spec.joined ?? null,
        left: spec.left ?? null,
        status: spec.status,
        description: null,
        sourceText: null,
        sourceUrl: source ?? null,
        roles: (spec.roles ?? []).map((role, position) => ({ contributionRoleId: this.vocabularies.roles[role], position, details: null })),
      },
    };
  }

  private async planWork(author: User, plan: Plan, spec: WorkSpec): Promise<void> {
    const id = await this.reserve(author, spec.key, 'work');
    plan.creations.push({
      entityId: id,
      operation: 'create_entity',
      targetPath: 'works',
      value: { title: spec.title, description: spec.description ?? null, iswc: null },
    });
    plan.completions.push(...this.credits(id, 'work_contributions', spec.credits));
  }

  private async planRecording(author: User, plan: Plan, spec: RecordingSpec): Promise<void> {
    const id = await this.reserve(author, spec.key, 'recording');
    plan.creations.push({
      entityId: id,
      operation: 'create_entity',
      targetPath: 'recordings',
      value: { title: spec.title, description: spec.description ?? null, recordingDate: spec.recordingDate ?? null },
    });
    for (const [index, genre] of (spec.genres ?? []).entries()) {
      plan.creations.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'recording_genres',
        targetKey: { recording_id: entity(id), genre_id: this.vocabularies.genres[genre] },
        value: { isPrimary: index === 0 },
      });
    }
    for (const { work, relationType } of spec.works) {
      plan.completions.push({
        entityId: id,
        operation: 'add_relation',
        targetPath: 'recording_works',
        value: { work: entity(this.root(work)), relationType },
      });
    }
    plan.completions.push(...this.credits(id, 'recording_contributions', spec.credits));
  }

  private credits(id: string, targetPath: string, credits: CreditSpec[] = []): SeedChange[] {
    return credits.map(({ identity, role }, position) => ({
      entityId: id,
      operation: 'add_relation',
      targetPath,
      value: { identity: entity(this.root(identity)), roleId: this.vocabularies.roles[role], position },
    }));
  }
}
