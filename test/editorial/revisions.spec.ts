import { randomUUID } from 'node:crypto';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { WIKIPEDIA, addChange, addSource, createDraft, decideChange, getJsonApi, reserveIdentity, submitIdentityCreation, submitProposal } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

describe('GET /v1/editorial-entities/{id}/revisions (E5)', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let ana: Account;
  let luis: Account;
  let entityId: string;

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

    // Ana creates IU; Luis changes her height.
    const creation = await submitIdentityCreation(app, ana.accessToken);
    entityId = creation.entityId;
    await decideChange(app, moderator.accessToken, creation.changeId, { action: 'apply' }).expect(201);
    const proposalId = await createDraft(app, luis.accessToken, 'Altura de IU');
    const change = await addChange(app, luis.accessToken, proposalId, {
      entityId,
      operation: 'set_fields',
      targetPath: 'people.height_cm',
      proposedValue: { exists: true, value: 170 },
    }).expect(201);
    await addSource(app, luis.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, luis.accessToken, proposalId).expect(200);
    await decideChange(app, moderator.accessToken, change.body.data.id, { action: 'apply' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const versions = (body: { data: { attributes: { version: number } }[] }) => body.data.map(({ attributes }) => attributes.version);

  it('lists every revision of the root to staff, in version order, with the values before and after', async () => {
    const response = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, moderator.accessToken).expect(200);

    expect(versions(response.body)).toEqual([1, 2]);
    expect(response.body.meta.total).toBe(2);
    expect(response.body.data[1]).toEqual({
      type: 'entity-revisions',
      id: expect.any(String),
      attributes: expect.objectContaining({ version: 2, beforeValue: { exists: true, value: 162 }, afterValue: { exists: true, value: 170 } }),
      relationships: expect.objectContaining({ entity: { data: { type: 'editorial-entities', id: entityId } } }),
    });
  });

  it('shows an author only the revisions of their own microchanges, and nobody else any', async () => {
    const ownByAna = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, ana.accessToken).expect(200);
    const ownByLuis = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, luis.accessToken).expect(200);
    const stranger = await registerVerified(app, 'curioso');
    const none = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, stranger.accessToken).expect(200);

    expect(versions(ownByAna.body)).toEqual([1]);
    expect(versions(ownByLuis.body)).toEqual([2]);
    expect(none.body).toEqual(expect.objectContaining({ data: [], meta: { total: 0 } }));
  });

  it('is not public', async () => {
    await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`).expect(401);
  });

  it('hides a reservation from anyone but its creator, as an unknown root', async () => {
    const reservation = await reserveIdentity(app, ana.accessToken);

    for (const id of [reservation, randomUUID(), 'not-a-uuid']) {
      const response = await getJsonApi(app, `/v1/editorial-entities/${id}/revisions`, moderator.accessToken).expect(404);
      expect(response.body.errors[0].code).toBe('editorial_entity_not_found');
    }
    const own = await getJsonApi(app, `/v1/editorial-entities/${reservation}/revisions`, ana.accessToken).expect(200);
    expect(own.body.data).toEqual([]);
  });

  it('rejects a sort or a filter it does not support', async () => {
    for (const sort of ['appliedAt', 'version', '-version']) {
      await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions?sort=${sort}`, moderator.accessToken).expect(400);
    }
    await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions?filter[change]=x`, moderator.accessToken).expect(400);
  });
});
