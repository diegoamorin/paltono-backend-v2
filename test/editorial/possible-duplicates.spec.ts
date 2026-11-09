import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  personCreation,
  reserveEntity,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
  updateChange,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

describe('possible duplicates in creations (possibleDuplicateOf)', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let ana: Account;
  let luis: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    ana = await registerVerified(app, 'ana');
    luis = await registerVerified(app, 'luis');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Publishes IU, a person, and returns her editorial root and public id. */
  async function publishPerson(): Promise<{ entityId: string; publicId: string }> {
    const { entityId, changeId } = await submitIdentityCreation(app, ana.accessToken);
    const { body } = await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision').expect(201);
    return { entityId, publicId: body.included[0].attributes.resultKey.publicId };
  }

  /** Luis's draft creating another person, maybe marked. */
  async function draftCreation(possibleDuplicateOf?: string | null) {
    const entityId = await reserveIdentity(app, luis.accessToken);
    const proposalId = await createDraft(app, luis.accessToken, 'Alta de otra IU');
    const response = await addChange(app, luis.accessToken, proposalId, {
      entityId,
      proposedValue: personCreation({ displayName: 'IU (cantante)' }),
      ...(possibleDuplicateOf === undefined ? {} : { possibleDuplicateOf }),
    });
    return { entityId, proposalId, response };
  }

  it('marks a creation as a possible duplicate of a published entry, and shows the mark on the microchange', async () => {
    const iu = await publishPerson();

    const { response } = await draftCreation(iu.publicId);

    expect(response.status).toBe(201);
    expect(response.body.data.attributes.possibleDuplicateOf).toBe(iu.publicId);
  });

  it('sets and clears the mark while the proposal is a draft, and leaves it when other attributes change', async () => {
    const iu = await publishPerson();
    const { proposalId, response } = await draftCreation();
    const changeId = response.body.data.id;
    expect(response.body.data.attributes.possibleDuplicateOf).toBeNull();

    const marked = await updateChange(app, luis.accessToken, proposalId, changeId, { possibleDuplicateOf: iu.publicId }).expect(200);
    expect(marked.body.data.attributes.possibleDuplicateOf).toBe(iu.publicId);
    const moved = await updateChange(app, luis.accessToken, proposalId, changeId, { position: 5 }).expect(200);
    expect(moved.body.data.attributes.possibleDuplicateOf).toBe(iu.publicId);
    const listed = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, luis.accessToken).expect(200);
    expect(listed.body.data[0].attributes.possibleDuplicateOf).toBe(iu.publicId);

    const cleared = await updateChange(app, luis.accessToken, proposalId, changeId, { possibleDuplicateOf: null }).expect(200);
    expect(cleared.body.data.attributes.possibleDuplicateOf).toBeNull();
  });

  it('names a work by its id', async () => {
    const workRoot = await reserveEntity(app, ana.accessToken, 'work').expect(201);
    const proposalId = await createDraft(app, ana.accessToken, 'Alta de Butter');
    const creation = await addChange(app, ana.accessToken, proposalId, {
      entityId: workRoot.body.data.id,
      targetPath: 'works',
      proposedValue: { exists: true, value: { title: 'Butter' } },
    }).expect(201);
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    const applied = await decideChange(app, moderator.accessToken, creation.body.data.id, { action: 'apply' }, '?include=revision').expect(201);
    const butter = String(applied.body.included[0].attributes.resultKey.id);

    const entityId = (await reserveEntity(app, luis.accessToken, 'work').expect(201)).body.data.id;
    const draftId = await createDraft(app, luis.accessToken, 'Alta de Butter otra vez');
    const response = await addChange(app, luis.accessToken, draftId, {
      entityId,
      targetPath: 'works',
      proposedValue: { exists: true, value: { title: 'Butter (canción)' } },
      possibleDuplicateOf: butter,
    }).expect(201);

    expect(response.body.data.attributes.possibleDuplicateOf).toBe(butter);
  });

  it('refuses an entry that does not exist, is not published or is of another type, and any other operation', async () => {
    const iu = await publishPerson();
    const withdrawn = await publishPerson();
    const withdrawal = await createDraft(app, ana.accessToken, 'Retirada');
    const { body } = await addChange(app, ana.accessToken, withdrawal, {
      entityId: withdrawn.entityId,
      operation: 'withdraw_entity',
      targetPath: 'publication_status',
      proposedValue: { exists: true, value: 'withdrawn' },
    }).expect(201);
    await addSource(app, ana.accessToken, withdrawal, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, withdrawal).expect(200);
    await decideChange(app, admin.accessToken, body.data.id, { action: 'apply' }).expect(201);

    const error = (response: { body: { errors: { code: string; source: { pointer: string } }[] } }) => response.body.errors.map(({ code, source }) => [code, source.pointer]);
    const pointer = '/data/attributes/possibleDuplicateOf';

    const unknown = (await draftCreation('no-such-entry')).response;
    expect(unknown.status).toBe(422);
    expect(error(unknown)).toEqual([['possible_duplicate_not_found', pointer]]);
    const notPublished = (await draftCreation(withdrawn.publicId)).response;
    expect(notPublished.status).toBe(422);
    expect(error(notPublished)).toEqual([['possible_duplicate_not_published', pointer]]);
    const workRoot = (await reserveEntity(app, luis.accessToken, 'work').expect(201)).body.data.id;
    const workDraft = await createDraft(app, luis.accessToken, 'Alta de una obra');
    const otherType = await addChange(app, luis.accessToken, workDraft, {
      entityId: workRoot,
      targetPath: 'works',
      proposedValue: { exists: true, value: { title: 'IU' } },
      possibleDuplicateOf: iu.publicId,
    }).expect(422);
    expect(error(otherType)).toEqual([['possible_duplicate_not_found', pointer]]);

    const fieldDraft = await createDraft(app, luis.accessToken, 'Altura de IU');
    const fieldChange = await addChange(app, luis.accessToken, fieldDraft, {
      entityId: iu.entityId,
      operation: 'set_fields',
      targetPath: 'people.height_cm',
      proposedValue: { exists: true, value: 162 },
      possibleDuplicateOf: iu.publicId,
    }).expect(422);
    expect(error(fieldChange)).toEqual([['possible_duplicate_not_allowed', pointer]]);
    const added = await addChange(app, luis.accessToken, fieldDraft, {
      entityId: iu.entityId,
      operation: 'set_fields',
      targetPath: 'people.height_cm',
      proposedValue: { exists: true, value: 162 },
    }).expect(201);
    const patched = await updateChange(app, luis.accessToken, fieldDraft, added.body.data.id, { possibleDuplicateOf: iu.publicId }).expect(422);
    expect(error(patched)).toEqual([['possible_duplicate_not_allowed', pointer]]);
  });

  it('fixes the mark on submission, shows it in the moderation queue and blocks nothing', async () => {
    const iu = await publishPerson();
    const { proposalId, response } = await draftCreation(iu.publicId);
    const changeId = response.body.data.id;
    await addSource(app, luis.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, luis.accessToken, proposalId).expect(200);

    const refused = await updateChange(app, luis.accessToken, proposalId, changeId, { possibleDuplicateOf: null }).expect(409);
    expect(refused.body.errors[0].code).toBe('proposal_submitted');

    const queue = await getJsonApi(app, '/v1/moderation/changes', moderator.accessToken).expect(200);
    expect(queue.body.data).toEqual([expect.objectContaining({ id: changeId, attributes: expect.objectContaining({ possibleDuplicateOf: iu.publicId }) })]);
    const publicView = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`).expect(200);
    expect(publicView.body.data[0].attributes.possibleDuplicateOf).toBe(iu.publicId);

    const applied = await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision').expect(201);
    const entry = await getJsonApi(app, `/v1/identities/${applied.body.included[0].attributes.resultKey.publicId}`).expect(200);
    expect(entry.body.data.attributes).not.toHaveProperty('possibleDuplicateOf');
  });
});
