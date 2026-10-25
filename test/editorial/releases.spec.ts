import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, decideChange, getJsonApi, reserveEntity, submitProposal } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });

describe('release groups and releases in the editorial flow', () => {
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

  function reject(changeId: string) {
    return decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason: 'Sin fuente fiable' });
  }

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos del lanzamiento');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return changeIds;
  }

  const reserve = async (entityType: string): Promise<string> => (await reserveEntity(app, ana.accessToken, entityType).expect(201)).body.data.id;

  const groupCreation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'release_groups',
    proposedValue: present(value),
  });

  const releaseCreation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'releases',
    proposedValue: present(value),
  });

  const setField = (entityId: string, targetPath: string, value: unknown): ChangeInput => ({
    entityId,
    operation: 'set_fields',
    targetPath,
    proposedValue: present(value),
  });

  /** Publishes a release group and returns its editorial root and public id. */
  async function publishGroup(value: object = { title: 'BE', type: 'album' }): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('release_group');
    const [changeId] = await submitChanges([groupCreation(entityId, value)]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  /** Publishes a release of a group and returns its editorial root and public id. */
  async function publishRelease(group: string, value: object = {}): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('release');
    const [changeId] = await submitChanges([releaseCreation(entityId, { releaseGroup: { entity_id: group }, ...value })]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  describe('release groups', () => {
    it('publishes a release group with only a title and a type, before any release', async () => {
      const { entityId, id } = await publishGroup({ title: 'BE', type: 'album' });

      const { body } = await getJsonApi(app, `/v1/release-groups/${id}`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'release-groups',
          id,
          attributes: expect.objectContaining({
            publicationStatus: 'published',
            title: 'BE',
            type: 'album',
            description: null,
            releaseDate: null,
            upcoming: false,
            nextReleaseDate: null,
            releaseInstant: null,
          }),
          meta: { editorialEntityId: entityId },
        }),
      );
    });

    it('refuses a blank title or an unknown type', async () => {
      const entityId = await reserve('release_group');
      const proposalId = await createDraft(app, ana.accessToken);
      const pointer = async (value: object) =>
        (await addChange(app, ana.accessToken, proposalId, groupCreation(entityId, value)).expect(422)).body.errors[0].source.pointer;

      expect(await pointer({ title: '  ', type: 'album' })).toBe('/data/attributes/proposedValue/value/title');
      expect(await pointer({ title: 'BE', type: 'mixtape' })).toBe('/data/attributes/proposedValue/value/type');
    });
  });

  describe('releases', () => {
    it('publishes a release with only its release group, showing the group title without copying it', async () => {
      const group = await publishGroup({ title: 'BE', type: 'album' });
      const { entityId, id } = await publishRelease(group.entityId);

      const { body } = await getJsonApi(app, `/v1/releases/${id}?include=releaseGroup`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'releases',
          id,
          attributes: expect.objectContaining({
            title: null,
            displayTitle: 'BE',
            editionName: null,
            releaseDate: null,
            releaseTime: null,
            timezone: null,
            releaseInstant: null,
            availability: 'unknown',
            isCancelled: false,
            coverArt: null,
          }),
          relationships: expect.objectContaining({ releaseGroup: { data: { type: 'release-groups', id: group.id } } }),
          meta: { editorialEntityId: entityId },
        }),
      );
      expect(body.included).toEqual([expect.objectContaining({ type: 'release-groups', id: group.id })]);
    });

    it('validates the date, the time and its IANA zone', async () => {
      const group = await publishGroup();
      const entityId = await reserve('release');
      const proposalId = await createDraft(app, ana.accessToken);
      const pointer = async (value: object) =>
        (
          await addChange(app, ana.accessToken, proposalId, releaseCreation(entityId, { releaseGroup: { entity_id: group.entityId }, ...value })).expect(422)
        ).body.errors[0].source.pointer;

      expect(await pointer({ releaseDate: { year: 2026, month: 2, day: 30 } })).toBe('/data/attributes/proposedValue/value/releaseDate/day');
      expect(await pointer({ releaseDate: { year: 2026, month: 11, day: 20 }, releaseTime: '18:00' })).toBe('/data/attributes/proposedValue/value/timezone');
      expect(await pointer({ releaseDate: { year: 2026, month: 11 }, releaseTime: '18:00', timezone: 'Asia/Seoul' })).toBe(
        '/data/attributes/proposedValue/value/releaseTime',
      );
      expect(await pointer({ releaseDate: { year: 2026, month: 11, day: 20 }, releaseTime: '18:00', timezone: 'Corea/Seúl' })).toBe(
        '/data/attributes/proposedValue/value/timezone',
      );
      expect(await pointer({ releaseDate: { year: 2026, month: 11, day: 20 }, releaseTime: '18:00', timezone: '+09:00' })).toBe(
        '/data/attributes/proposedValue/value/timezone',
      );
    });

    it('refuses a release whose group is neither published nor created by the proposal', async () => {
      const group = await reserve('release_group');
      const entityId = await reserve('release');
      const proposalId = await createDraft(app, ana.accessToken);

      const { body } = await addChange(app, ana.accessToken, proposalId, releaseCreation(entityId, { releaseGroup: { entity_id: group } })).expect(422);

      expect(body.errors[0]).toEqual(
        expect.objectContaining({ code: 'invalid_reference', source: { pointer: '/data/attributes/proposedValue/value/releaseGroup/entity_id' } }),
      );
    });

    it('publishes a release group and its release together in an atomic group', async () => {
      const group = await reserve('release_group');
      const release = await reserve('release');
      const atomicGroupId = 'b0e7c5a2-6f0d-4a59-9d55-0c9b4f6b1e21';
      const [, created] = await submitChanges([
        { ...groupCreation(group, { title: 'BE', type: 'album' }), atomicGroupId },
        { ...releaseCreation(release, { releaseGroup: { entity_id: group } }), atomicGroupId },
      ]);

      const { body } = await apply(created).expect(201);

      expect(body.data.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['applied', 'applied']);
    });

    it('blocks a release whose release group is rejected, so it is never published', async () => {
      const group = await reserve('release_group');
      const release = await reserve('release');
      const [groupChange, releaseChange] = await submitChanges([
        groupCreation(group, { title: 'BE', type: 'album' }),
        releaseCreation(release, { releaseGroup: { entity_id: group } }),
      ]);

      expect((await apply(releaseChange).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await reject(groupChange).expect(201);

      const changes = (await getJsonApi(app, `/v1/proposal-changes/${releaseChange}/decisions`, ana.accessToken).expect(200)).body.data;
      expect(changes.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['blocked']);
      const entity = await getJsonApi(app, `/v1/editorial-entities/${release}`, ana.accessToken).expect(200);
      expect(entity.body.data.attributes.publicationStatus).toBe('reserved');
    });

    it('keeps at most one unnamed release per release group', async () => {
      const group = await publishGroup();
      const first = await reserve('release');
      const second = await reserve('release');
      const deluxe = await reserve('release');
      const [firstChange] = await submitChanges([releaseCreation(first, { releaseGroup: { entity_id: group.entityId } })]);
      const [secondChange] = await submitChanges([releaseCreation(second, { releaseGroup: { entity_id: group.entityId } })]);
      const [deluxeChange] = await submitChanges([releaseCreation(deluxe, { releaseGroup: { entity_id: group.entityId }, editionName: 'Deluxe' })]);
      await apply(firstChange).expect(201);

      const refused = await apply(secondChange).expect(409);

      expect(refused.body.errors[0].code).toBe('base_changed');
      expect((await getJsonApi(app, `/v1/editorial-entities/${second}`, ana.accessToken).expect(200)).body.data.attributes.publicationStatus).toBe('reserved');
      await apply(deluxeChange).expect(201);
      const { body } = await getJsonApi(app, `/v1/release-groups/${group.id}/releases`).expect(200);
      expect(body.data.map(({ attributes }: { attributes: { editionName: string | null } }) => attributes.editionName).sort()).toEqual(['Deluxe', null]);
    });

    it('moves a release to another group as a field change, leaving a competing move in conflict', async () => {
      const be = await publishGroup({ title: 'BE', type: 'album' });
      const deluxe = await publishGroup({ title: 'BE (Deluxe)', type: 'album' });
      const other = await publishGroup({ title: 'Map of the Soul: 7', type: 'album' });
      const release = await publishRelease(be.entityId, { editionName: 'Deluxe' });
      const [moved] = await submitChanges([setField(release.entityId, 'releases.release_group', { entity_id: deluxe.entityId })]);
      const [competing] = await submitChanges([setField(release.entityId, 'releases.release_group', { entity_id: other.entityId })]);

      await apply(moved).expect(201);

      const { body } = await getJsonApi(app, `/v1/releases/${release.id}`).expect(200);
      expect(body.data.relationships.releaseGroup.data.id).toBe(deluxe.id);
      expect((await apply(competing).expect(409)).body.errors[0].code).toBe('base_changed');
      const decisions = (await getJsonApi(app, `/v1/proposal-changes/${competing}/decisions`, ana.accessToken).expect(200)).body.data;
      expect(decisions[0].attributes.resultingStatus).toBe('conflicted');
    });
  });

  describe('presentation credits', () => {
    /** Publishes an identity with an artist profile; returns its editorial root and the artist's public id. */
    async function publishArtist(displayName: string): Promise<{ entityId: string; id: string }> {
      const entityId = await reserve('identity');
      const [creation, profile] = await submitChanges([
        { entityId, proposedValue: present({ type: 'organization', displayName, organization: {} }) },
        {
          entityId,
          operation: 'add_relation',
          targetPath: 'artists',
          targetKey: { catalog_identity_id: { entity_id: entityId } },
          proposedValue: present({}),
        },
      ]);
      const created = await apply(creation).expect(201);
      await apply(profile).expect(201);
      const identityId = created.body.included[0].attributes.resultKey.publicId;
      const { body } = await getJsonApi(app, `/v1/identities/${identityId}`).expect(200);
      return { entityId, id: body.data.relationships.artist.data.id };
    }

    const credit = (group: string, artist: string, value: object | null, operation = 'add_relation'): ChangeInput => ({
      entityId: group,
      operation,
      targetPath: 'release_artist_credits',
      targetKey: { release_group_id: { entity_id: group }, artist_id: { entity_id: artist } },
      proposedValue: value === null ? { exists: false } : present(value),
    });

    it('presents a release group with its artists in order, and lists it once in each discography', async () => {
      const bts = await publishArtist('BTS');
      const halsey = await publishArtist('Halsey');
      const group = await publishGroup({ title: 'Map of the Soul: Persona', type: 'ep' });
      await publishRelease(group.entityId);
      await publishRelease(group.entityId, { editionName: 'Version 2' });
      for (const changeId of await submitChanges([
        credit(group.entityId, halsey.entityId, { position: 1, creditedAs: null }),
        credit(group.entityId, bts.entityId, { position: 0, creditedAs: '방탄소년단' }),
      ])) {
        await apply(changeId).expect(201);
      }

      const { body } = await getJsonApi(app, `/v1/release-groups/${group.id}?include=artistCredits.artist`).expect(200);
      const credits = body.included.filter(({ type }: { type: string }) => type === 'release-artist-credits');
      expect(credits.map(({ attributes }: { attributes: object }) => attributes)).toEqual([
        { position: 0, creditedAs: '방탄소년단' },
        { position: 1, creditedAs: null },
      ]);
      expect(credits.map(({ relationships }: { relationships: { artist: { data: { id: string } } } }) => relationships.artist.data.id)).toEqual([bts.id, halsey.id]);
      const discography = await getJsonApi(app, `/v1/artists/${bts.id}/release-groups`).expect(200);
      expect(discography.body.data.map(({ id }: { id: string }) => id)).toEqual([group.id]);
      expect((await getJsonApi(app, `/v1/artists/${bts.id}/release-groups?filter[type]=album`).expect(200)).body.data).toEqual([]);
      const filtered = await getJsonApi(app, `/v1/release-groups?filter[artist]=${halsey.id}`).expect(200);
      expect(filtered.body.data.map(({ id }: { id: string }) => id)).toEqual([group.id]);
    });

    it('updates and removes a credit by its group and artist', async () => {
      const bts = await publishArtist('BTS');
      const group = await publishGroup();
      await apply((await submitChanges([credit(group.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
      await apply((await submitChanges([credit(group.entityId, bts.entityId, { position: 0, creditedAs: 'Bangtan Boys' }, 'update_relation')]))[0]).expect(201);

      let { body } = await getJsonApi(app, `/v1/release-groups/${group.id}?include=artistCredits`).expect(200);
      expect(body.included[0].attributes.creditedAs).toBe('Bangtan Boys');
      await apply((await submitChanges([credit(group.entityId, bts.entityId, null, 'remove_relation')]))[0]).expect(201);
      ({ body } = await getJsonApi(app, `/v1/release-groups/${group.id}`).expect(200));
      expect(body.data.relationships.artistCredits.data).toEqual([]);
    });

    it('accepts no new credit of a withdrawn artist, but removes an existing one', async () => {
      const bts = await publishArtist('BTS');
      const group = await publishGroup();
      await apply((await submitChanges([credit(group.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
      const [withdrawal] = await submitChanges([
        { entityId: bts.entityId, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') },
      ]);
      await decideChange(app, admin.accessToken, withdrawal, { action: 'apply' }).expect(201);

      const proposalId = await createDraft(app, ana.accessToken);
      const update = await addChange(app, ana.accessToken, proposalId, credit(group.entityId, bts.entityId, { position: 1 }, 'update_relation')).expect(422);
      expect(update.body.errors[0].code).toBe('entity_withdrawn');
      await apply((await submitChanges([credit(group.entityId, bts.entityId, null, 'remove_relation')]))[0]).expect(201);
    });

    it('needs an identity with an artist profile, and keeps the profile while credited', async () => {
      const bts = await publishArtist('BTS');
      const group = await publishGroup();
      const person = await reserve('identity');
      await apply((await submitChanges([{ entityId: person, proposedValue: present({ type: 'person', displayName: 'RM', person: {} }) }]))[0]).expect(201);
      const proposalId = await createDraft(app, ana.accessToken);

      const missing = await addChange(app, ana.accessToken, proposalId, credit(group.entityId, person, { position: 0 })).expect(422);
      expect(missing.body.errors[0].code).toBe('no_artist_profile');
      const notGroup = await addChange(app, ana.accessToken, proposalId, credit(group.entityId, group.entityId, { position: 0 })).expect(422);
      expect(notGroup.body.errors[0].source.pointer).toBe('/data/attributes/targetKey/artist_id/entity_id');

      await apply((await submitChanges([credit(group.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
      const removal = await addChange(app, ana.accessToken, proposalId, {
        entityId: bts.entityId,
        operation: 'remove_relation',
        targetPath: 'artists',
        targetKey: { catalog_identity_id: { entity_id: bts.entityId } },
        proposedValue: { exists: false },
      }).expect(422);
      expect(removal.body.errors[0].code).toBe('artist_referenced');
    });

    it('credits an artist created by the same proposal once its creation applies', async () => {
      const group = await publishGroup();
      const artist = await reserve('identity');
      const [creation, profile, credited] = await submitChanges([
        { entityId: artist, proposedValue: present({ type: 'organization', displayName: 'NewJeans', organization: {} }) },
        {
          entityId: artist,
          operation: 'add_relation',
          targetPath: 'artists',
          targetKey: { catalog_identity_id: { entity_id: artist } },
          proposedValue: present({}),
        },
        credit(group.entityId, artist, { position: 0 }),
      ]);

      expect((await apply(credited).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await apply(creation).expect(201);
      await apply(profile).expect(201);
      await apply(credited).expect(201);
    });
  });

  describe('repackages', () => {
    it('links a repackage to its original and lists it among the repackages', async () => {
      const original = await publishGroup({ title: 'Love Yourself: Her', type: 'ep' });
      const repackage = await publishGroup({ title: 'Love Yourself: Answer', type: 'compilation', repackageOf: { entity_id: original.entityId } });

      const { body } = await getJsonApi(app, `/v1/release-groups/${repackage.id}?include=repackageOf`).expect(200);
      expect(body.data.relationships.repackageOf.data).toEqual({ type: 'release-groups', id: original.id });
      expect(body.included[0].attributes.title).toBe('Love Yourself: Her');
      const listed = await getJsonApi(app, `/v1/release-groups/${original.id}/repackages`).expect(200);
      expect(listed.body.data.map(({ id }: { id: string }) => id)).toEqual([repackage.id]);
    });

    it('refuses a repackage of itself or one that would close a cycle, writing nothing', async () => {
      const first = await publishGroup({ title: 'Her', type: 'ep' });
      const second = await publishGroup({ title: 'Answer', type: 'compilation', repackageOf: { entity_id: first.entityId } });
      const third = await publishGroup({ title: 'Answer+', type: 'compilation', repackageOf: { entity_id: second.entityId } });
      const proposalId = await createDraft(app, ana.accessToken);

      const self = await addChange(app, ana.accessToken, proposalId, setField(first.entityId, 'release_groups.repackage_of', { entity_id: first.entityId })).expect(422);
      expect(self.body.errors[0].code).toBe('invalid_reference');
      const cycle = await addChange(app, ana.accessToken, proposalId, setField(first.entityId, 'release_groups.repackage_of', { entity_id: third.entityId })).expect(422);
      expect(cycle.body.errors[0].code).toBe('repackage_cycle');
    });

    it('refuses at decision a cycle that another link closed after submission', async () => {
      const first = await publishGroup({ title: 'Her', type: 'ep' });
      const second = await publishGroup({ title: 'Answer', type: 'compilation' });
      const [forward] = await submitChanges([setField(second.entityId, 'release_groups.repackage_of', { entity_id: first.entityId })]);
      const [backward] = await submitChanges([setField(first.entityId, 'release_groups.repackage_of', { entity_id: second.entityId })]);
      await apply(forward).expect(201);

      const { body } = await apply(backward).expect(422);

      expect(body.errors[0].code).toBe('repackage_cycle');
      const revisions = await getJsonApi(app, `/v1/editorial-entities/${first.entityId}/revisions`, moderator.accessToken).expect(200);
      expect(revisions.body.data).toHaveLength(1);
    });
  });
});
