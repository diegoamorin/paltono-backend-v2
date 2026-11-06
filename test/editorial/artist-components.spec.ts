import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  reserveIdentity,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const ARTISTS = 'artists';
const DEBUT = 'artists.debut';
const MEMBERSHIPS = 'organization_memberships';
const AFFILIATIONS = 'artist_organization_affiliations';

describe('artist profiles, memberships and affiliations of identities', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let ana: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    ana = await registerVerified(app, 'ana');
  });

  afterAll(async () => {
    await app.close();
  });

  function apply(changeId: string) {
    return decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  }

  async function submitChanges(changes: ChangeInput[]): Promise<{ proposalId: string; changeIds: string[] }> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos de IU');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return { proposalId, changeIds };
  }

  /** The public id of each identity the test published, by editorial root. */
  const publicIds = new Map<string, string>();

  async function publish(value: object): Promise<string> {
    const entityId = await reserveIdentity(app, ana.accessToken);
    const { changeIds } = await submitChanges([{ entityId, proposedValue: { exists: true, value } }]);
    const response = await apply(changeIds[0]).expect(201);
    publicIds.set(entityId, response.body.included[0].attributes.resultKey.publicId);
    return entityId;
  }

  const publishPerson = (displayName = 'IU') => publish({ type: 'person', displayName, person: {} });
  const publishOrganization = (displayName = 'EDAM Entertainment') => publish({ type: 'organization', displayName, organization: {} });

  const artistProfile = (entityId: string, operation = 'add_relation'): ChangeInput => ({
    entityId,
    operation,
    targetPath: ARTISTS,
    targetKey: { catalog_identity_id: { entity_id: entityId } },
    proposedValue: operation === 'add_relation' ? { exists: true, value: {} } : { exists: false },
  });

  const identity = (entityId: string, include = 'artist') => getJsonApi(app, `/v1/identities/${publicIds.get(entityId)}?include=${include}`);

  describe('artist profiles', () => {
    it('adds the artist profile of an identity, at most once', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges([artistProfile(entityId)]);
      const second = await submitChanges([artistProfile(entityId)]);

      const addition = await apply(first.changeIds[0]).expect(201);
      expect(addition.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: false }, afterValue: { exists: true, value: {} } }),
      );
      const repeated = await apply(second.changeIds[0]).expect(201);
      expect(repeated.body.data[0].attributes.resultingStatus).toBe('satisfied');

      const { body } = await identity(entityId).expect(200);
      expect(body.data.relationships.artist.data).toEqual({ type: 'artists', id: expect.any(String) });
      expect(body.included).toEqual([expect.objectContaining({ type: 'artists', id: body.data.relationships.artist.data.id })]);
    });

    it('adds the profile within the creation of the identity', async () => {
      const entityId = await reserveIdentity(app, ana.accessToken);
      const { changeIds } = await submitChanges([
        { entityId, proposedValue: { exists: true, value: { type: 'person', displayName: 'IU', person: {} } } },
        artistProfile(entityId),
      ]);

      await apply(changeIds[0]).expect(201);
      const response = await apply(changeIds[1]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('applied');
    });

    it('removes the profile', async () => {
      const entityId = await publishPerson();
      await apply((await submitChanges([artistProfile(entityId)])).changeIds[0]).expect(201);

      const removed = await submitChanges([artistProfile(entityId, 'remove_relation')]);
      await apply(removed.changeIds[0]).expect(201);

      const { body } = await identity(entityId).expect(200);
      expect(body.data.relationships.artist.data).toBeNull();
    });
  });

  describe('debut', () => {
    const setDebut = (entityId: string, value: object | null): ChangeInput => ({
      entityId,
      operation: 'set_fields',
      targetPath: DEBUT,
      proposedValue: { exists: true, value },
    });

    const publishArtistProfile = async (entityId: string) => {
      await apply((await submitChanges([artistProfile(entityId)])).changeIds[0]).expect(201);
      return entityId;
    };

    const shownDebut = async (entityId: string) => {
      const { body } = await identity(entityId).expect(200);
      return body.included.find(({ type }: { type: string }) => type === 'artists').attributes.debut;
    };

    it('starts empty, and a moderator applies a proposed debut of an artist', async () => {
      const entityId = await publishArtistProfile(await publishPerson());
      expect(await shownDebut(entityId)).toBeNull();

      const { changeIds } = await submitChanges([setDebut(entityId, { year: 2008, month: 9, day: 18 })]);
      await apply(changeIds[0]).expect(201);

      expect(await shownDebut(entityId)).toEqual({ year: 2008, month: 9, day: 18 });
    });

    const problem = async (change: ChangeInput) => {
      const proposalId = await createDraft(app, ana.accessToken);
      return (await addChange(app, ana.accessToken, proposalId, change).expect(422)).body.errors[0];
    };

    it('exists only on an identity with an artist profile', async () => {
      const entityId = await publishPerson();

      expect((await problem(setDebut(entityId, { year: 2008 }))).code).toBe('no_artist_profile');
    });

    it('is a real calendar date', async () => {
      const entityId = await publishArtistProfile(await publishPerson());

      expect((await problem(setDebut(entityId, { year: 2008, month: 2, day: 30 }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/day',
      });
    });

    it('cannot be wholly before the birth, and a birth cannot move past it', async () => {
      const entityId = await publishArtistProfile(await publish({ type: 'person', displayName: 'IU', person: { birthDate: { year: 1993, month: 5, day: 16 } } }));

      expect((await problem(setDebut(entityId, { year: 1992 }))).code).toBe('inconsistent_value');
      await apply((await submitChanges([setDebut(entityId, { year: 1993 })])).changeIds[0]).expect(201);

      const birth: ChangeInput = { entityId, operation: 'set_fields', targetPath: 'people.birth_date', proposedValue: { exists: true, value: { year: 1994 } } };
      expect((await problem(birth)).code).toBe('inconsistent_value');
    });

    it('may share its year with a birth known only by its year', async () => {
      const entityId = await publishArtistProfile(await publish({ type: 'person', displayName: 'IU', person: { birthDate: { year: 1993 } } }));

      await apply((await submitChanges([setDebut(entityId, { year: 1993, month: 1 })])).changeIds[0]).expect(201);
    });

    it('is not compared with a birthday, in either direction', async () => {
      const entityId = await publishArtistProfile(await publish({ type: 'person', displayName: 'IU', person: { birthDate: { month: 5, day: 16 } } }));

      await apply((await submitChanges([setDebut(entityId, { year: 1 })])).changeIds[0]).expect(201);
      const birthday: ChangeInput = { entityId, operation: 'set_fields', targetPath: 'people.birth_date', proposedValue: { exists: true, value: { month: 1, day: 1 } } };
      await apply((await submitChanges([birthday])).changeIds[0]).expect(201);
    });

    it('cannot be wholly before the founding, and a founding cannot move past it', async () => {
      const entityId = await publishArtistProfile(
        await publish({ type: 'organization', displayName: 'Metallica', organization: { founding: { year: 1981, month: 10 } } }),
      );

      expect((await problem(setDebut(entityId, { year: 1981, month: 9 }))).code).toBe('inconsistent_value');
      await apply((await submitChanges([setDebut(entityId, { year: 1981 })])).changeIds[0]).expect(201);

      const founding: ChangeInput = { entityId, operation: 'set_fields', targetPath: 'organizations.founding', proposedValue: { exists: true, value: { year: 1982 } } };
      expect((await problem(founding)).code).toBe('inconsistent_value');
    });

    it('does not apply once the profile it belongs to was removed', async () => {
      const entityId = await publishArtistProfile(await publishPerson());
      const { changeIds } = await submitChanges([setDebut(entityId, { year: 2008 })]);
      await apply((await submitChanges([artistProfile(entityId, 'remove_relation')])).changeIds[0]).expect(201);

      const response = await apply(changeIds[0]).expect(422);

      expect(response.body.errors[0].code).toBe('no_artist_profile');
    });

    it('is added together with the profile in an atomic group', async () => {
      const entityId = await publishPerson();
      const atomicGroupId = '7b1f9f0e-6a3c-4c58-9c7e-2d1f4b8a6e10';

      const { changeIds } = await submitChanges([
        { ...artistProfile(entityId), atomicGroupId },
        { ...setDebut(entityId, { year: 2008 }), atomicGroupId },
      ]);
      await apply(changeIds[0]).expect(201);

      expect(await shownDebut(entityId)).toEqual({ year: 2008, month: null, day: null });
    });

    it('refuses a group that sets the debut before adding the profile, instead of losing it', async () => {
      const entityId = await publishPerson();
      const atomicGroupId = '7b1f9f0e-6a3c-4c58-9c7e-2d1f4b8a6e11';

      const { changeIds } = await submitChanges([
        { ...setDebut(entityId, { year: 2008 }), atomicGroupId },
        { ...artistProfile(entityId), atomicGroupId },
      ]);
      const response = await apply(changeIds[0]);

      expect(response.status).toBeGreaterThanOrEqual(400);
      const { body } = await identity(entityId).expect(200);
      expect(body.data.relationships.artist.data).toBeNull();
    });

    it('keeps a profile from being removed until the debut is emptied', async () => {
      const entityId = await publishArtistProfile(await publishPerson());
      await apply((await submitChanges([setDebut(entityId, { year: 2008 })])).changeIds[0]).expect(201);

      expect((await problem(artistProfile(entityId, 'remove_relation'))).code).toBe('artist_referenced');

      await apply((await submitChanges([setDebut(entityId, null)])).changeIds[0]).expect(201);
      await apply((await submitChanges([artistProfile(entityId, 'remove_relation')])).changeIds[0]).expect(201);

      const { body } = await identity(entityId).expect(200);
      expect(body.data.relationships.artist.data).toBeNull();
    });
  });

  describe('memberships', () => {
    let vocalist: number;
    let composer: number;

    beforeEach(async () => {
      const role = (slug: string, scopes: string[]) =>
        createdEntryId(app, admin.accessToken, 'contribution-roles', { slug, name: slug, category: 'performance', scopes });
      vocalist = Number(await role('vocalist', ['membership', 'recording']));
      composer = Number(await role('composer', ['work']));
    });

    const membership = (organization: string, member: string, overrides: object = {}) => ({
      member: { entity_id: member },
      joined: { year: 2016, month: 8, day: 8 },
      left: null,
      status: 'current',
      description: null,
      sourceText: null,
      sourceUrl: null,
      roles: [{ contributionRoleId: vocalist, position: 0, details: 'Vocalista principal' }],
      ...overrides,
    });

    const addMembership = (organization: string, value: object): ChangeInput => ({
      entityId: organization,
      operation: 'add_relation',
      targetPath: MEMBERSHIPS,
      proposedValue: { exists: true, value },
    });

    it('adds, updates and removes a membership with its roles', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await publishPerson('Jisoo');

      const added = await submitChanges([addMembership(group, membership(group, member))]);
      const addition = await apply(added.changeIds[0]).expect(201);
      const { resultKey, afterValue } = addition.body.included[0].attributes;
      expect(afterValue).toEqual({ exists: true, value: membership(group, member) });

      const departed = membership(group, member, { left: { year: 2023, month: 12 }, status: 'former', roles: [] });
      const updated = await submitChanges([
        { entityId: group, operation: 'update_relation', targetPath: MEMBERSHIPS, targetKey: resultKey, proposedValue: { exists: true, value: departed } },
      ]);
      const update = await apply(updated.changeIds[0]).expect(201);
      expect(update.body.included[0].attributes.afterValue).toEqual({ exists: true, value: departed });

      const removed = await submitChanges([
        { entityId: group, operation: 'remove_relation', targetPath: MEMBERSHIPS, targetKey: resultKey, proposedValue: { exists: false } },
      ]);
      const removal = await apply(removed.changeIds[0]).expect(201);
      expect(removal.body.included[0].attributes.afterValue).toEqual({ exists: false });
    });

    it('takes a member created in the same proposal, which it then depends on', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await reserveIdentity(app, ana.accessToken);
      const { changeIds } = await submitChanges([
        { entityId: member, proposedValue: { exists: true, value: { type: 'person', displayName: 'Jisoo', person: {} } } },
        addMembership(group, membership(group, member.toUpperCase())),
      ]);

      const early = await apply(changeIds[1]).expect(409);
      expect(early.body.errors[0]).toEqual(expect.objectContaining({ code: 'dependency_unresolved', meta: { dependsOn: [changeIds[0]] } }));
      await apply(changeIds[0]).expect(201);
      const response = await apply(changeIds[1]).expect(201);
      expect(response.body.included[0].attributes.afterValue.value.member).toEqual({ entity_id: member });
    });

    it('rejects a member that is the organization itself, unknown, withdrawn or a reservation of another proposal', async () => {
      const group = await publishOrganization('BLACKPINK');
      const withdrawn = await publishPerson('Retirada');
      const { changeIds } = await submitChanges([{ entityId: withdrawn, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } }]);
      await decideChange(app, admin.accessToken, changeIds[0], { action: 'apply' }).expect(201);
      const reservation = await reserveIdentity(app, ana.accessToken);
      const proposalId = await createDraft(app, ana.accessToken);

      const codes = async (member: string) => {
        const response = await addChange(app, ana.accessToken, proposalId, addMembership(group, membership(group, member))).expect(422);
        expect(response.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/member' });
        return response.body.errors[0].code;
      };
      expect(await codes(group)).toBe('invalid_reference');
      expect(await codes('00000000-0000-4000-8000-000000000000')).toBe('invalid_reference');
      expect(await codes(withdrawn)).toBe('entity_withdrawn');
      expect(await codes(reservation)).toBe('invalid_reference');
    });

    it('validates the organization, the status, the dates and the scope of the roles', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await publishPerson('Jisoo');
      const proposalId = await createDraft(app, ana.accessToken);
      const problem = async (entityId: string, value: object) =>
        (await addChange(app, ana.accessToken, proposalId, addMembership(entityId, value)).expect(422)).body.errors[0];

      expect((await problem(member, membership(member, group))).code).toBe('inapplicable_target');
      expect((await problem(group, membership(group, member, { left: { year: 2023 } }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/status',
      });
      expect((await problem(group, membership(group, member, { status: 'unknown', left: { year: 2015 } }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/status',
      });
      expect((await problem(group, membership(group, member, { status: 'former', left: { year: 2015 } }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/left',
      });
      const outOfScope = await problem(group, membership(group, member, { roles: [{ contributionRoleId: composer, position: 0, details: null }] }));
      expect(outOfScope).toEqual(
        expect.objectContaining({ code: 'role_out_of_scope', source: { pointer: '/data/attributes/proposedValue/value/roles/0/contributionRoleId' } }),
      );
    });

    it('refuses a period that certainly overlaps another of the same member, but not an uncertain one', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await publishPerson('Jisoo');
      const first = { joined: { year: 2010 }, left: { year: 2012, month: 3 }, status: 'former' };
      await apply((await submitChanges([addMembership(group, membership(group, member, first))])).changeIds[0]).expect(201);

      const overlapping = await submitChanges([addMembership(group, membership(group, member, { joined: { year: 2011, month: 6 } }))]);
      const uncertain = await submitChanges([addMembership(group, membership(group, member, { joined: { year: 2012 } }))]);

      const conflict = await apply(overlapping.changeIds[0]).expect(409);
      expect(conflict.body.errors[0].code).toBe('base_changed');
      await apply(uncertain.changeIds[0]).expect(201);
    });

    it('takes memberships whose starts differ in precision in the same proposal, not two with the same start', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await publishPerson('Jisoo');
      const proposalId = await createDraft(app, ana.accessToken);
      const add = (joined: object) => addChange(app, ana.accessToken, proposalId, addMembership(group, membership(group, member, { joined })));

      await add({ year: 2020, month: 3 }).expect(201);
      await add({ year: 2020 }).expect(201);

      expect((await add({ year: 2020 }).expect(422)).body.errors[0].code).toBe('overlapping_change');
    });

    it('refuses a second current membership of the same member in the organization', async () => {
      const group = await publishOrganization('Corazón Serrano');
      const member = await publishPerson('Lesly Águila');
      await apply((await submitChanges([addMembership(group, membership(group, member))])).changeIds[0]).expect(201);

      const second = await submitChanges([addMembership(group, membership(group, member, { joined: { year: 2018, month: 1, day: 25 } }))]);
      await apply(second.changeIds[0]).expect(409);
      const rebased = await decideChange(app, moderator.accessToken, second.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 2,
        reason: 'Segunda actual',
      }).expect(409);

      expect(rebased.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'constraint_violated', detail: 'El miembro ya tiene una membresía actual en esta organización' }),
      );
    });

    it('lets a member hold one current membership at a time when periods are updated', async () => {
      const group = await publishOrganization('Corazón Serrano');
      const member = await publishPerson('Lesly Águila');
      const addAndApply = async (value: object) =>
        (await apply((await submitChanges([addMembership(group, membership(group, member, value))])).changeIds[0]).expect(201)).body
          .included[0].attributes.resultKey;
      const updateMembership = (targetKey: object, value: object): ChangeInput => ({
        entityId: group,
        operation: 'update_relation',
        targetPath: MEMBERSHIPS,
        targetKey,
        proposedValue: { exists: true, value: membership(group, member, value) },
      });
      const first = { joined: { year: 2010 }, left: { year: 2011 }, status: 'former' };
      const second = { joined: { year: 2018, month: 1, day: 25 } };
      const firstKey = await addAndApply(first);
      const secondKey = await addAndApply(second);

      const reopened = await submitChanges([updateMembership(firstKey, { ...first, left: null, status: 'current' })]);
      await apply(reopened.changeIds[0]).expect(409);
      const rebased = await decideChange(app, moderator.accessToken, reopened.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 3,
        reason: 'Reabre un periodo',
      }).expect(409);
      expect(rebased.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'constraint_violated', detail: 'El miembro ya tiene una membresía actual en esta organización' }),
      );

      await apply((await submitChanges([updateMembership(secondKey, { ...second, roles: [] })])).changeIds[0]).expect(201);
      const departed = { ...second, left: { year: 2020 }, status: 'former' };
      await apply((await submitChanges([updateMembership(secondKey, departed)])).changeIds[0]).expect(201);
      await addAndApply({ joined: { year: 2022 } });
    });

    it('does not apply a membership whose member was withdrawn after it was submitted', async () => {
      const group = await publishOrganization('BLACKPINK');
      const member = await publishPerson('Jisoo');
      const { changeIds } = await submitChanges([addMembership(group, membership(group, member))]);
      const withdrawal = await submitChanges([
        { entityId: member, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } },
      ]);
      await decideChange(app, admin.accessToken, withdrawal.changeIds[0], { action: 'apply' }).expect(201);

      const response = await apply(changeIds[0]).expect(409);

      expect(response.body.errors[0].code).toBe('referenced_entity_unpublished');
    });

    it('refuses a membership that would make two organizations members of each other', async () => {
      const group = await publishOrganization('BLACKPINK');
      const unit = await publishOrganization('Subunidad');
      await apply((await submitChanges([addMembership(group, membership(group, unit, { roles: [] }))])).changeIds[0]).expect(201);

      const cyclic = await submitChanges([addMembership(unit, membership(unit, group, { roles: [] }))]);
      await apply(cyclic.changeIds[0]).expect(409);
      const rebased = await decideChange(app, moderator.accessToken, cyclic.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 1,
        reason: 'Ciclo',
      }).expect(409);
      expect(rebased.body.errors[0]).toEqual(expect.objectContaining({ code: 'constraint_violated', detail: expect.stringContaining('ciclo') }));
    });
  });

  describe('affiliations', () => {
    const affiliation = (organization: string, overrides: object = {}) => ({
      organization: { entity_id: organization },
      relationshipType: 'agency',
      startedAt: { year: 2008, month: 9, day: 18 },
      endedAt: null,
      status: 'current',
      description: null,
      ...overrides,
    });

    const addAffiliation = (artist: string, value: object): ChangeInput => ({
      entityId: artist,
      operation: 'add_relation',
      targetPath: AFFILIATIONS,
      proposedValue: { exists: true, value },
    });

    async function publishArtist(displayName = 'IU'): Promise<string> {
      const entityId = await publishPerson(displayName);
      await apply((await submitChanges([artistProfile(entityId)])).changeIds[0]).expect(201);
      return entityId;
    }

    it('adds, updates and removes an affiliation of an artist', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();

      const added = await submitChanges([addAffiliation(artist, affiliation(agency))]);
      const addition = await apply(added.changeIds[0]).expect(201);
      const { resultKey, afterValue } = addition.body.included[0].attributes;
      expect(afterValue).toEqual({ exists: true, value: affiliation(agency) });

      const ended = affiliation(agency, { endedAt: { year: 2024, month: 12 }, status: 'former' });
      const updated = await submitChanges([
        { entityId: artist, operation: 'update_relation', targetPath: AFFILIATIONS, targetKey: resultKey, proposedValue: { exists: true, value: ended } },
      ]);
      expect((await apply(updated.changeIds[0]).expect(201)).body.included[0].attributes.afterValue).toEqual({ exists: true, value: ended });

      const removed = await submitChanges([
        { entityId: artist, operation: 'remove_relation', targetPath: AFFILIATIONS, targetKey: resultKey, proposedValue: { exists: false } },
      ]);
      expect((await apply(removed.changeIds[0]).expect(201)).body.included[0].attributes.afterValue).toEqual({ exists: false });
    });

    it('needs an artist profile, an organization other than the artist and coherent dates', async () => {
      const person = await publishPerson('Sin perfil');
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const proposalId = await createDraft(app, ana.accessToken);
      const problem = async (entityId: string, value: object) =>
        (await addChange(app, ana.accessToken, proposalId, addAffiliation(entityId, value)).expect(422)).body.errors[0];

      expect((await problem(person, affiliation(agency))).code).toBe('no_artist_profile');
      expect((await problem(artist, affiliation(person))).code).toBe('not_an_organization');
      expect((await problem(artist, affiliation(agency, { endedAt: { year: 2020 } }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/status',
      });
      expect((await problem(artist, affiliation(agency, { status: 'unknown', endedAt: { year: 2020 } }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/status',
      });
      expect((await problem(artist, affiliation(agency, { endedAt: { year: 2001 }, status: 'former' }))).source).toEqual({
        pointer: '/data/attributes/proposedValue/value/endedAt',
      });
      expect((await problem(artist, affiliation(agency, { relationshipType: 'owner' }))).code).toBe('invalid_payload');
    });

    it('takes a year, a year and month, a complete date or null, and refuses the rest', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const proposalId = await createDraft(app, ana.accessToken);
      const add = (value: object) => addChange(app, ana.accessToken, proposalId, addAffiliation(artist, value));
      const former = (startedAt: object | null, endedAt: object | null) => affiliation(agency, { startedAt, endedAt, status: 'former' });

      await add(former({ year: 2015 }, { year: 2016, month: 3 })).expect(201);
      await add(former({ year: 2015, month: 3 }, null)).expect(201);
      await add(former(null, { year: 2016 })).expect(201);
      await add(former({ year: 2015, month: 3, day: 14 }, null)).expect(201);

      expect((await add(affiliation(agency, { startedAt: '2008-09-18' })).expect(422)).body.errors[0].code).toBe('invalid_payload');
      expect((await add(affiliation(agency, { startedAt: { month: 9 } })).expect(422)).body.errors[0].code).toBe('invalid_payload');
      expect((await add(affiliation(agency, { startedAt: { year: 2021, month: 2, day: 29 } })).expect(422)).body.errors[0].source).toEqual({
        pointer: '/data/attributes/proposedValue/value/startedAt/day',
      });
      expect((await add(former({ year: 2017 }, { year: 2024, month: 4, day: 31 })).expect(422)).body.errors[0].source).toEqual({
        pointer: '/data/attributes/proposedValue/value/endedAt/day',
      });
    });

    it('refuses an end wholly before the start, not one that may be after it', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const proposalId = await createDraft(app, ana.accessToken);
      const add = (startedAt: object, endedAt: object) =>
        addChange(app, ana.accessToken, proposalId, addAffiliation(artist, affiliation(agency, { startedAt, endedAt, status: 'former' })));

      await add({ year: 2020 }, { year: 2020, month: 3 }).expect(201);
      await add({ year: 2020, month: 3 }, { year: 2020 }).expect(201);
      await add({ year: 2021, month: 3 }, { year: 2021, month: 3, day: 1 }).expect(201);

      const refused = await add({ year: 2022, month: 3 }, { year: 2022, month: 2 }).expect(422);
      expect(refused.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/endedAt' });
    });

    it('never affiliates an organization with its own profile', async () => {
      const label = await publishOrganization('Sello con perfil');
      await apply((await submitChanges([artistProfile(label)])).changeIds[0]).expect(201);
      const proposalId = await createDraft(app, ana.accessToken);

      const response = await addChange(app, ana.accessToken, proposalId, addAffiliation(label, affiliation(label))).expect(422);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'invalid_reference', source: { pointer: '/data/attributes/proposedValue/value/organization' } }),
      );
    });

    it('keeps a profile with affiliations from being removed', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      await apply((await submitChanges([addAffiliation(artist, affiliation(agency))])).changeIds[0]).expect(201);
      const proposalId = await createDraft(app, ana.accessToken);

      const response = await addChange(app, ana.accessToken, proposalId, artistProfile(artist, 'remove_relation')).expect(422);

      expect(response.body.errors[0].code).toBe('artist_referenced');
    });

    it('takes a second identical affiliation as satisfied', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const first = await submitChanges([addAffiliation(artist, affiliation(agency))]);
      const second = await submitChanges([addAffiliation(artist, affiliation(agency))]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('satisfied');
    });

    it.each([
      ['a partial start', { year: 2020, month: 3 }],
      ['an unknown start', null],
    ])('takes two affiliations with the same organization, type and %s as the same one', async (_, startedAt) => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const first = await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt }))]);
      const second = await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt }))]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('satisfied');
    });

    it('tells apart affiliations whose starts differ in precision', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const first = await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt: { year: 2020 } }))]);
      const second = await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt: { year: 2020, month: 3 } }))]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('applied');
    });

    it('refuses to update an affiliation to the start of another one', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      await apply((await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt: { year: 2020 } }))])).changeIds[0]).expect(201);
      const later = await apply((await submitChanges([addAffiliation(artist, affiliation(agency, { startedAt: { year: 2021 } }))])).changeIds[0]).expect(201);

      const moved = await submitChanges([
        {
          entityId: artist,
          operation: 'update_relation',
          targetPath: AFFILIATIONS,
          targetKey: later.body.included[0].attributes.resultKey,
          proposedValue: { exists: true, value: affiliation(agency, { startedAt: { year: 2020 } }) },
        },
      ]);
      await apply(moved.changeIds[0]).expect(409);
      const rebased = await decideChange(app, moderator.accessToken, moved.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 4,
        reason: 'Mismo inicio',
      }).expect(409);

      expect(rebased.body.errors[0]).toEqual(expect.objectContaining({ code: 'constraint_violated', detail: expect.stringContaining('afiliación') }));
    });

    it('takes affiliations whose starts differ in precision in the same proposal, not two with the same start', async () => {
      const artist = await publishArtist();
      const agency = await publishOrganization();
      const proposalId = await createDraft(app, ana.accessToken);
      const add = (startedAt: object) => addChange(app, ana.accessToken, proposalId, addAffiliation(artist, affiliation(agency, { startedAt })));

      await add({ year: 2020, month: 3 }).expect(201);
      await add({ year: 2020 }).expect(201);

      expect((await add({ year: 2020 }).expect(422)).body.errors[0].code).toBe('overlapping_change');
    });
  });
});
