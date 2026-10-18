import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  personCreation,
  reserveEntity,
  reserveIdentity,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const present = (value: unknown) => ({ exists: true, value });

describe('recordings in the editorial flow', () => {
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

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos de la grabación');
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

  const recordingCreation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'recordings',
    proposedValue: present(value),
  });

  const workCreation = (entityId: string, title: string): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'works',
    proposedValue: present({ title }),
  });

  /** Publishes a recording and returns its editorial root and public id. */
  async function publishRecording(value: object = { title: 'Butter' }): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('recording');
    const [changeId] = await submitChanges([recordingCreation(entityId, value)]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  async function publishWork(title: string): Promise<string> {
    const entityId = await reserve('work');
    const [changeId] = await submitChanges([workCreation(entityId, title)]);
    await apply(changeId).expect(201);
    return entityId;
  }

  describe('creation and fields', () => {
    it('publishes a recording with its explicit content, ISRC and partial recording date', async () => {
      const { entityId, id } = await publishRecording({ title: 'Butter', isExplicit: true, isrc: 'USA2P2125949', recordingDate: { year: 2021, month: 5 } });

      const { body } = await getJsonApi(app, `/v1/recordings/${id}`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'recordings',
          id,
          attributes: expect.objectContaining({
            publicationStatus: 'published',
            title: 'Butter',
            description: null,
            isExplicit: true,
            isrc: 'USA2P2125949',
            recordingDate: { year: 2021, month: 5, day: null },
            primaryGenreId: null,
          }),
          meta: { editorialEntityId: entityId },
        }),
      );
    });

    it('defaults to non-explicit and changes the recording date as one field', async () => {
      const { entityId, id } = await publishRecording();
      const [changeId] = await submitChanges([
        { entityId, operation: 'set_fields', targetPath: 'recordings.recording_date', proposedValue: present({ year: 2021, month: 2, day: 28 }) },
      ]);
      await apply(changeId).expect(201);

      const { body } = await getJsonApi(app, `/v1/recordings/${id}`).expect(200);
      expect(body.data.attributes).toEqual(expect.objectContaining({ isExplicit: false, recordingDate: { year: 2021, month: 2, day: 28 } }));
    });

    it('validates the ISRC and the recording date', async () => {
      const entityId = await reserve('recording');
      const proposalId = await createDraft(app, ana.accessToken);
      const pointer = async (value: object) =>
        (await addChange(app, ana.accessToken, proposalId, recordingCreation(entityId, value)).expect(422)).body.errors[0].source.pointer;

      expect(await pointer({ title: 'Butter', isrc: 'US-A2P-21-25949' })).toBe('/data/attributes/proposedValue/value/isrc');
      expect(await pointer({ title: 'Butter', recordingDate: { year: 2021, month: 2, day: 30 } })).toBe('/data/attributes/proposedValue/value/recordingDate/day');
      expect(await pointer({ title: 'Butter', recordingDate: { year: 2021, day: 3 } })).toBe('/data/attributes/proposedValue/value/recordingDate');
    });
  });

  describe('genres', () => {
    let kpop: number;
    let dance: number;

    beforeEach(async () => {
      kpop = Number(await createdEntryId(app, admin.accessToken, 'genres', { slug: 'k-pop', name: 'K-pop' }));
      dance = Number(await createdEntryId(app, admin.accessToken, 'genres', { slug: 'dance-pop', name: 'Dance pop' }));
    });

    const genre = (entityId: string, genreId: number, isPrimary: boolean, operation = 'add_relation'): ChangeInput => ({
      entityId,
      operation,
      targetPath: 'recording_genres',
      targetKey: { recording_id: { entity_id: entityId }, genre_id: genreId },
      proposedValue: operation === 'remove_relation' ? { exists: false } : present({ isPrimary }),
    });

    it('assigns genres within the creation, with at most one primary', async () => {
      const entityId = await reserve('recording');
      const [creation, first, second] = await submitChanges([
        recordingCreation(entityId, { title: 'Butter' }),
        genre(entityId, kpop, true),
        genre(entityId, dance, false),
      ]);
      const created = await apply(creation).expect(201);
      await apply(first).expect(201);
      await apply(second).expect(201);

      const id = created.body.included[0].attributes.resultKey.publicId;
      const { body } = await getJsonApi(app, `/v1/recordings/${id}?include=genres`).expect(200);
      expect(body.data.attributes.primaryGenreId).toBe(String(kpop));
      expect(body.data.relationships.genres.data).toEqual([
        { type: 'genres', id: String(kpop) },
        { type: 'genres', id: String(dance) },
      ]);
      expect(body.included.map(({ attributes }: { attributes: { slug: string } }) => attributes.slug)).toEqual(['k-pop', 'dance-pop']);

      const [competing] = await submitChanges([genre(entityId, dance, true, 'update_relation')]);
      const refused = await apply(competing).expect(409);
      expect(refused.body.errors[0].code).toBe('base_changed');
    });

    it('refuses a genre that does not exist', async () => {
      const { entityId } = await publishRecording();
      const proposalId = await createDraft(app, ana.accessToken);

      const { body } = await addChange(app, ana.accessToken, proposalId, genre(entityId, dance + 100, false)).expect(422);

      expect(body.errors[0]).toEqual(expect.objectContaining({ code: 'unknown_vocabulary_entry', source: { pointer: '/data/attributes/targetKey/genre_id' } }));
    });
  });

  describe('works', () => {
    const link = (entityId: string, value: object, operation = 'add_relation', targetKey?: object): ChangeInput => ({
      entityId,
      operation,
      targetPath: 'recording_works',
      proposedValue: operation === 'remove_relation' ? { exists: false } : present(value),
      ...(targetKey ? { targetKey } : {}),
    });

    it('relates a medley to the works it performs, in order, and to a sampled one', async () => {
      const { entityId, id } = await publishRecording({ title: 'Medley' });
      const first = await publishWork('Butter');
      const second = await publishWork('Dynamite');
      const changeIds = await submitChanges([
        link(entityId, { work: { entity_id: second }, relationType: 'performance', position: 2 }),
        link(entityId, { work: { entity_id: first }, relationType: 'performance', position: 1 }),
        link(entityId, { work: { entity_id: first }, relationType: 'sample' }),
      ]);
      for (const changeId of changeIds) await apply(changeId).expect(201);

      const { body } = await getJsonApi(app, `/v1/recordings/${id}?include=recordingWorks.work`).expect(200);
      const links = body.included.filter(({ type }: { type: string }) => type === 'recording-works');
      expect(body.data.relationships.recordingWorks.data.map(({ id: linkId }: { id: string }) => links.find((each: { id: string }) => each.id === linkId).attributes)).toEqual([
        expect.objectContaining({ relationType: 'performance', position: 1 }),
        expect.objectContaining({ relationType: 'performance', position: 2 }),
        expect.objectContaining({ relationType: 'sample', position: null }),
      ]);
      expect(body.included.filter(({ type }: { type: string }) => type === 'works').map(({ attributes }: { attributes: { title: string } }) => attributes.title).sort()).toEqual([
        'Butter',
        'Dynamite',
      ]);
    });

    it('keeps one link per work and relation type, and refuses an unknown type', async () => {
      const { entityId } = await publishRecording();
      const work = await publishWork('Butter');
      const [first] = await submitChanges([link(entityId, { work: { entity_id: work }, relationType: 'performance' })]);
      const [second] = await submitChanges([link(entityId, { work: { entity_id: work }, relationType: 'performance', position: 1 } )]);
      await apply(first).expect(201);

      expect((await apply(second).expect(409)).body.errors[0].code).toBe('base_changed');

      const proposalId = await createDraft(app, ana.accessToken);
      const invalid = await addChange(app, ana.accessToken, proposalId, link(entityId, { work: { entity_id: work }, relationType: 'cover' })).expect(422);
      expect(invalid.body.errors[0].source.pointer).toBe('/data/attributes/proposedValue/value/relationType');
    });

    it('publishes a work and the link of a recording to it in one atomic group', async () => {
      const { entityId, id } = await publishRecording();
      const work = await reserve('work');
      const group = 'f1a7a8d4-2c1e-4b63-9a63-2a52c7e3b0d1';
      const [, linked] = await submitChanges([
        { ...workCreation(work, 'Butter'), atomicGroupId: group },
        { ...link(entityId, { work: { entity_id: work }, relationType: 'performance' }), atomicGroupId: group },
      ]);

      const response = await apply(linked).expect(201);

      expect(response.body.data.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['applied', 'applied']);
      const { body } = await getJsonApi(app, `/v1/recordings/${id}?include=recordingWorks.work`).expect(200);
      expect(body.included.find(({ type }: { type: string }) => type === 'works').attributes.title).toBe('Butter');
    });

    it('relates a recording to a work created in the same proposal, after the work', async () => {
      const { entityId } = await publishRecording();
      const work = await reserve('work');
      const [creation, linked] = await submitChanges([workCreation(work, 'Butter'), link(entityId, { work: { entity_id: work }, relationType: 'performance' })]);

      expect((await apply(linked).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await apply(creation).expect(201);
      await apply(linked).expect(201);
    });
  });

  describe('credits', () => {
    it('credits an identity in a role of the recording scope only', async () => {
      const producer = Number(
        await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug: 'producer', name: 'Producción', category: 'production', scopes: ['recording'] }),
      );
      const lyricist = Number(
        await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug: 'lyricist', name: 'Letra', category: 'writing', scopes: ['work'] }),
      );
      const { entityId, id } = await publishRecording();
      const identity = await reserveIdentity(app, ana.accessToken);
      const credit = (roleId: number): ChangeInput => ({
        entityId,
        operation: 'add_relation',
        targetPath: 'recording_contributions',
        proposedValue: present({ identity: { entity_id: identity }, roleId, position: 0, details: 'Voz principal' }),
      });

      const proposalId = await createDraft(app, ana.accessToken);
      await addChange(app, ana.accessToken, proposalId, { entityId: identity, proposedValue: personCreation() }).expect(201);
      const refused = await addChange(app, ana.accessToken, proposalId, credit(lyricist)).expect(422);
      expect(refused.body.errors[0].code).toBe('role_out_of_scope');
      const added = await addChange(app, ana.accessToken, proposalId, credit(producer)).expect(201);
      await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, ana.accessToken, proposalId).expect(200);
      const creation = (await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, ana.accessToken).expect(200)).body.data[0].id;
      await apply(creation).expect(201);
      await apply(added.body.data.id).expect(201);

      const { body } = await getJsonApi(app, `/v1/recordings/${id}?include=contributions`).expect(200);
      expect(body.included).toEqual([
        expect.objectContaining({ type: 'recording-contributions', attributes: expect.objectContaining({ details: 'Voz principal', creditedAs: null }) }),
      ]);
    });
  });
});
