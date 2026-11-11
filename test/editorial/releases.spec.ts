import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, decideChange, getJsonApi, reserveEntity, submitProposal } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });

describe('releases and editions in the editorial flow', () => {
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

  const releaseCreation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'releases',
    proposedValue: present(value),
  });

  const editionCreation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'editions',
    proposedValue: present(value),
  });

  const setField = (entityId: string, targetPath: string, value: unknown): ChangeInput => ({
    entityId,
    operation: 'set_fields',
    targetPath,
    proposedValue: present(value),
  });

  /** Publishes a release and returns its editorial root and public id. */
  async function publishRelease(value: object = { title: 'BE', type: 'album' }): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('release');
    const [changeId] = await submitChanges([releaseCreation(entityId, value)]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  /** Publishes an edition of a release and returns its editorial root and public id. */
  async function publishEdition(release: string, value: object = {}): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('edition');
    const [changeId] = await submitChanges([editionCreation(entityId, { release: { entity_id: release }, ...value })]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  describe('releases', () => {
    it('publishes a release with only a title and a type, before any edition', async () => {
      const { entityId, id } = await publishRelease({ title: 'BE', type: 'album' });

      const { body } = await getJsonApi(app, `/v1/releases/${id}`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'releases',
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
      const entityId = await reserve('release');
      const proposalId = await createDraft(app, ana.accessToken);
      const pointer = async (value: object) =>
        (await addChange(app, ana.accessToken, proposalId, releaseCreation(entityId, value)).expect(422)).body.errors[0].source.pointer;

      expect(await pointer({ title: '  ', type: 'album' })).toBe('/data/attributes/proposedValue/value/title');
      expect(await pointer({ title: 'BE', type: 'mixtape' })).toBe('/data/attributes/proposedValue/value/type');
    });
  });

  describe('editions', () => {
    it('publishes an edition with only its release, showing the release title without copying it', async () => {
      const release = await publishRelease({ title: 'BE', type: 'album' });
      const { entityId, id } = await publishEdition(release.entityId);

      const { body } = await getJsonApi(app, `/v1/editions/${id}?include=release`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'editions',
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
          relationships: expect.objectContaining({ release: { data: { type: 'releases', id: release.id } } }),
          meta: { editorialEntityId: entityId },
        }),
      );
      expect(body.included).toEqual([expect.objectContaining({ type: 'releases', id: release.id })]);
    });

    it('validates the date, the time and its IANA zone', async () => {
      const release = await publishRelease();
      const entityId = await reserve('edition');
      const proposalId = await createDraft(app, ana.accessToken);
      const pointer = async (value: object) =>
        (
          await addChange(app, ana.accessToken, proposalId, editionCreation(entityId, { release: { entity_id: release.entityId }, ...value })).expect(422)
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

    it('refuses an edition whose release is neither published nor created by the proposal', async () => {
      const release = await reserve('release');
      const entityId = await reserve('edition');
      const proposalId = await createDraft(app, ana.accessToken);

      const { body } = await addChange(app, ana.accessToken, proposalId, editionCreation(entityId, { release: { entity_id: release } })).expect(422);

      expect(body.errors[0]).toEqual(
        expect.objectContaining({ code: 'invalid_reference', source: { pointer: '/data/attributes/proposedValue/value/release/entity_id' } }),
      );
    });

    it('publishes a release and its edition together in an atomic group', async () => {
      const release = await reserve('release');
      const edition = await reserve('edition');
      const atomicGroupId = 'b0e7c5a2-6f0d-4a59-9d55-0c9b4f6b1e21';
      const [, created] = await submitChanges([
        { ...releaseCreation(release, { title: 'BE', type: 'album' }), atomicGroupId },
        { ...editionCreation(edition, { release: { entity_id: release } }), atomicGroupId },
      ]);

      const { body } = await apply(created).expect(201);

      expect(body.data.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['applied', 'applied']);
    });

    it('blocks an edition whose release is rejected, so it is never published', async () => {
      const release = await reserve('release');
      const edition = await reserve('edition');
      const [releaseChange, editionChange] = await submitChanges([
        releaseCreation(release, { title: 'BE', type: 'album' }),
        editionCreation(edition, { release: { entity_id: release } }),
      ]);

      expect((await apply(editionChange).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await reject(releaseChange).expect(201);

      const changes = (await getJsonApi(app, `/v1/proposal-changes/${editionChange}/decisions`, ana.accessToken).expect(200)).body.data;
      expect(changes.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['blocked']);
      const entity = await getJsonApi(app, `/v1/editorial-entities/${edition}`, ana.accessToken).expect(200);
      expect(entity.body.data.attributes.publicationStatus).toBe('reserved');
    });

    it('keeps at most one unnamed edition per release', async () => {
      const release = await publishRelease();
      const first = await reserve('edition');
      const second = await reserve('edition');
      const deluxe = await reserve('edition');
      const [firstChange] = await submitChanges([editionCreation(first, { release: { entity_id: release.entityId } })]);
      const [secondChange] = await submitChanges([editionCreation(second, { release: { entity_id: release.entityId } })]);
      const [deluxeChange] = await submitChanges([editionCreation(deluxe, { release: { entity_id: release.entityId }, editionName: 'Deluxe' })]);
      await apply(firstChange).expect(201);

      const refused = await apply(secondChange).expect(409);

      expect(refused.body.errors[0].code).toBe('base_changed');
      expect((await getJsonApi(app, `/v1/editorial-entities/${second}`, ana.accessToken).expect(200)).body.data.attributes.publicationStatus).toBe('reserved');
      await apply(deluxeChange).expect(201);
      const { body } = await getJsonApi(app, `/v1/releases/${release.id}/editions`).expect(200);
      expect(body.data.map(({ attributes }: { attributes: { editionName: string | null } }) => attributes.editionName).sort()).toEqual(['Deluxe', null]);
    });

    it('moves an edition to another release as a field change, leaving a competing move in conflict', async () => {
      const be = await publishRelease({ title: 'BE', type: 'album' });
      const deluxe = await publishRelease({ title: 'BE (Deluxe)', type: 'album' });
      const other = await publishRelease({ title: 'Map of the Soul: 7', type: 'album' });
      const edition = await publishEdition(be.entityId, { editionName: 'Deluxe' });
      const [moved] = await submitChanges([setField(edition.entityId, 'editions.release', { entity_id: deluxe.entityId })]);
      const [competing] = await submitChanges([setField(edition.entityId, 'editions.release', { entity_id: other.entityId })]);

      await apply(moved).expect(201);

      const { body } = await getJsonApi(app, `/v1/editions/${edition.id}`).expect(200);
      expect(body.data.relationships.release.data).toEqual({ type: 'releases', id: deluxe.id });
      expect((await apply(competing).expect(409)).body.errors[0].code).toBe('base_changed');
      const decisions = (await getJsonApi(app, `/v1/proposal-changes/${competing}/decisions`, ana.accessToken).expect(200)).body.data;
      expect(decisions[0].attributes.resultingStatus).toBe('conflicted');
    });
  });

  describe('artist credits', () => {
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

    const credit = (release: string, artist: string, value: object | null, operation = 'add_relation'): ChangeInput => ({
      entityId: release,
      operation,
      targetPath: 'release_artist_credits',
      targetKey: { release_id: { entity_id: release }, artist_id: { entity_id: artist } },
      proposedValue: value === null ? { exists: false } : present(value),
    });

    it('presents a release with its artists in order, and lists it once in each discography', async () => {
      const bts = await publishArtist('BTS');
      const halsey = await publishArtist('Halsey');
      const release = await publishRelease({ title: 'Map of the Soul: Persona', type: 'ep' });
      await publishEdition(release.entityId);
      await publishEdition(release.entityId, { editionName: 'Version 2' });
      for (const changeId of await submitChanges([
        credit(release.entityId, halsey.entityId, { position: 1, creditedAs: null }),
        credit(release.entityId, bts.entityId, { position: 0, creditedAs: '방탄소년단' }),
      ])) {
        await apply(changeId).expect(201);
      }

      const { body } = await getJsonApi(app, `/v1/releases/${release.id}?include=artistCredits.artist`).expect(200);
      const credits = body.included.filter(({ type }: { type: string }) => type === 'release-artist-credits');
      expect(credits.map(({ attributes }: { attributes: object }) => attributes)).toEqual([
        { position: 0, creditedAs: '방탄소년단', displayName: '방탄소년단' },
        { position: 1, creditedAs: null, displayName: 'Halsey' },
      ]);
      expect(credits.map(({ relationships }: { relationships: { artist: { data: { id: string } } } }) => relationships.artist.data.id)).toEqual([bts.id, halsey.id]);
      const discography = await getJsonApi(app, `/v1/artists/${bts.id}/releases`).expect(200);
      expect(discography.body.data.map(({ id }: { id: string }) => id)).toEqual([release.id]);
      expect((await getJsonApi(app, `/v1/artists/${bts.id}/releases?filter[type]=album`).expect(200)).body.data).toEqual([]);
      const filtered = await getJsonApi(app, `/v1/releases?filter[artist]=${halsey.id}`).expect(200);
      expect(filtered.body.data.map(({ id }: { id: string }) => id)).toEqual([release.id]);
    });

    it('updates and removes a credit by its release and artist', async () => {
      const bts = await publishArtist('BTS');
      const release = await publishRelease();
      await apply((await submitChanges([credit(release.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
      await apply((await submitChanges([credit(release.entityId, bts.entityId, { position: 0, creditedAs: 'Bangtan Boys' }, 'update_relation')]))[0]).expect(201);

      let { body } = await getJsonApi(app, `/v1/releases/${release.id}?include=artistCredits`).expect(200);
      expect(body.included[0].attributes.creditedAs).toBe('Bangtan Boys');
      await apply((await submitChanges([credit(release.entityId, bts.entityId, null, 'remove_relation')]))[0]).expect(201);
      ({ body } = await getJsonApi(app, `/v1/releases/${release.id}`).expect(200));
      expect(body.data.relationships.artistCredits.data).toEqual([]);
    });

    it('accepts no new credit of a withdrawn artist, but removes an existing one', async () => {
      const bts = await publishArtist('BTS');
      const release = await publishRelease();
      await apply((await submitChanges([credit(release.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
      const [withdrawal] = await submitChanges([
        { entityId: bts.entityId, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') },
      ]);
      await decideChange(app, admin.accessToken, withdrawal, { action: 'apply' }).expect(201);

      const proposalId = await createDraft(app, ana.accessToken);
      const update = await addChange(app, ana.accessToken, proposalId, credit(release.entityId, bts.entityId, { position: 1 }, 'update_relation')).expect(422);
      expect(update.body.errors[0].code).toBe('entity_withdrawn');
      await apply((await submitChanges([credit(release.entityId, bts.entityId, null, 'remove_relation')]))[0]).expect(201);
    });

    it('needs an identity with an artist profile, and keeps the profile while credited', async () => {
      const bts = await publishArtist('BTS');
      const release = await publishRelease();
      const person = await reserve('identity');
      await apply((await submitChanges([{ entityId: person, proposedValue: present({ type: 'person', displayName: 'RM', person: {} }) }]))[0]).expect(201);
      const proposalId = await createDraft(app, ana.accessToken);

      const missing = await addChange(app, ana.accessToken, proposalId, credit(release.entityId, person, { position: 0 })).expect(422);
      expect(missing.body.errors[0].code).toBe('no_artist_profile');
      const notArtist = await addChange(app, ana.accessToken, proposalId, credit(release.entityId, release.entityId, { position: 0 })).expect(422);
      expect(notArtist.body.errors[0].source.pointer).toBe('/data/attributes/targetKey/artist_id/entity_id');

      await apply((await submitChanges([credit(release.entityId, bts.entityId, { position: 0 })]))[0]).expect(201);
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
      const release = await publishRelease();
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
        credit(release.entityId, artist, { position: 0 }),
      ]);

      expect((await apply(credited).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await apply(creation).expect(201);
      await apply(profile).expect(201);
      await apply(credited).expect(201);
    });
  });

  describe('repackages', () => {
    it('links a repackage to its original and lists it among the repackages', async () => {
      const original = await publishRelease({ title: 'Love Yourself: Her', type: 'ep' });
      const repackage = await publishRelease({ title: 'Love Yourself: Answer', type: 'compilation', repackageOf: { entity_id: original.entityId } });

      const { body } = await getJsonApi(app, `/v1/releases/${repackage.id}?include=repackageOf`).expect(200);
      expect(body.data.relationships.repackageOf.data).toEqual({ type: 'releases', id: original.id });
      expect(body.included[0].attributes.title).toBe('Love Yourself: Her');
      const listed = await getJsonApi(app, `/v1/releases/${original.id}/repackages`).expect(200);
      expect(listed.body.data.map(({ id }: { id: string }) => id)).toEqual([repackage.id]);
    });

    it('refuses a repackage of itself or one that would close a cycle, writing nothing', async () => {
      const first = await publishRelease({ title: 'Her', type: 'ep' });
      const second = await publishRelease({ title: 'Answer', type: 'compilation', repackageOf: { entity_id: first.entityId } });
      const third = await publishRelease({ title: 'Answer+', type: 'compilation', repackageOf: { entity_id: second.entityId } });
      const proposalId = await createDraft(app, ana.accessToken);

      const self = await addChange(app, ana.accessToken, proposalId, setField(first.entityId, 'releases.repackage_of', { entity_id: first.entityId })).expect(422);
      expect(self.body.errors[0].code).toBe('invalid_reference');
      const cycle = await addChange(app, ana.accessToken, proposalId, setField(first.entityId, 'releases.repackage_of', { entity_id: third.entityId })).expect(422);
      expect(cycle.body.errors[0].code).toBe('repackage_cycle');
    });

    it('refuses at decision a cycle that another link closed after submission', async () => {
      const first = await publishRelease({ title: 'Her', type: 'ep' });
      const second = await publishRelease({ title: 'Answer', type: 'compilation' });
      const [forward] = await submitChanges([setField(second.entityId, 'releases.repackage_of', { entity_id: first.entityId })]);
      const [backward] = await submitChanges([setField(first.entityId, 'releases.repackage_of', { entity_id: second.entityId })]);
      await apply(forward).expect(201);

      const { body } = await apply(backward).expect(422);

      expect(body.errors[0].code).toBe('repackage_cycle');
      const revisions = await getJsonApi(app, `/v1/editorial-entities/${first.entityId}/revisions`, moderator.accessToken).expect(200);
      expect(revisions.body.data).toHaveLength(1);
    });
  });
});
