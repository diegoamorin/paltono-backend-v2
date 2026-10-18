import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  draftIdentityCreation,
  getJsonApi,
  submitIdentityCreation,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60_000;

describe('GET /v1/moderation/changes (E19)', () => {
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

  const setHeight = (entityId: string, heightCm: number): ChangeInput => ({
    entityId,
    operation: 'set_fields',
    targetPath: 'people.height_cm',
    proposedValue: { exists: true, value: heightCm },
  });

  async function submitChange(account: Account, change: ChangeInput) {
    const proposalId = await createDraft(app, account.accessToken, 'Altura de IU');
    const { body } = await addChange(app, account.accessToken, proposalId, change).expect(201);
    await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, account.accessToken, proposalId).expect(200);
    return { proposalId, changeId: body.data.id as string };
  }

  /**
   * IU published by Ana; then, a minute apart: Ana's height (applied), Luis's
   * height (left in conflict), Luis's creation of another person (pending)
   * and a draft of Ana's, which the queue never shows.
   */
  async function seedQueue() {
    const iu = await submitIdentityCreation(app, ana.accessToken);
    await decideChange(app, moderator.accessToken, iu.changeId, { action: 'apply' }).expect(201);
    app.clock.advance(MINUTE);
    const applied = await submitChange(ana, setHeight(iu.entityId, 172));
    app.clock.advance(MINUTE);
    const conflicted = await submitChange(luis, setHeight(iu.entityId, 175));
    await decideChange(app, moderator.accessToken, applied.changeId, { action: 'apply' }).expect(201);
    app.clock.advance(MINUTE);
    const pending = await submitIdentityCreation(app, luis.accessToken);
    app.clock.advance(MINUTE);
    await draftIdentityCreation(app, ana.accessToken);
    return { iu, conflicted, pending };
  }

  const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

  it('lists the pending and conflicted microchanges of submissions to staff, oldest first, with their states', async () => {
    const { conflicted, pending } = await seedQueue();

    for (const account of [moderator, admin]) {
      const response = await getJsonApi(app, '/v1/moderation/changes', account.accessToken).expect(200);

      expect(ids(response.body)).toEqual([conflicted.changeId, pending.changeId]);
      expect(response.body.meta).toEqual({ total: 2, informationKind: 'proposed' });
      expect(response.body.data.map(({ attributes }: { attributes: { status: string } }) => attributes.status)).toEqual(['conflicted', 'pending']);
      expect(response.body.data[0].relationships).toEqual(
        expect.objectContaining({ proposal: { data: { type: 'proposals', id: conflicted.proposalId } } }),
      );
    }
  });

  it('includes the proposal, its sources and the root', async () => {
    const { iu, conflicted } = await seedQueue();

    const response = await getJsonApi(app, '/v1/moderation/changes?include=proposal,proposal.sources,entity&filter[status]=conflicted', moderator.accessToken).expect(200);

    const included = (type: string) => response.body.included.filter((resource: { type: string }) => resource.type === type);
    expect(included('proposals')).toEqual([expect.objectContaining({ id: conflicted.proposalId, attributes: expect.objectContaining({ status: 'open' }) })]);
    expect(included('proposal-sources')).toEqual([expect.objectContaining({ attributes: expect.objectContaining({ url: WIKIPEDIA }) })]);
    expect(included('editorial-entities')).toEqual([
      expect.objectContaining({ id: iu.entityId, attributes: expect.objectContaining({ entityType: 'identity', publicationStatus: 'published', currentVersion: 2 }) }),
    ]);
  });

  it('filters by status, type of root, operation, author and root, and sorts newest first on request', async () => {
    const { iu, conflicted, pending } = await seedQueue();
    const list = async (query: string) => ids((await getJsonApi(app, `/v1/moderation/changes?${query}`, moderator.accessToken).expect(200)).body);

    expect(await list('filter[status]=pending')).toEqual([pending.changeId]);
    expect(await list('filter[status]=pending,conflicted&sort=-createdAt')).toEqual([pending.changeId, conflicted.changeId]);
    expect(await list('filter[entityType]=identity')).toHaveLength(2);
    expect(await list('filter[entityType]=work')).toEqual([]);
    expect(await list('filter[operation]=create_entity')).toEqual([pending.changeId]);
    expect(await list(`filter[author]=${luis.uuid}`)).toHaveLength(2);
    expect(await list(`filter[author]=${ana.uuid}`)).toEqual([]);
    expect(await list(`filter[entity]=${iu.entityId}`)).toEqual([conflicted.changeId]);
  });

  it('rejects filters, sorts and includes outside the allowed ones', async () => {
    for (const query of [
      'filter[status]=applied',
      'filter[operation]=drop_table',
      'filter[entityType]=song',
      'filter[author]=nobody',
      'filter[entity]=nothing',
      'filter[proposal]=x',
      'sort=position',
      'include=proposal.changes',
    ]) {
      await getJsonApi(app, `/v1/moderation/changes?${query}`, moderator.accessToken).expect(400);
    }
  });

  it('is only for staff', async () => {
    await seedQueue();

    await getJsonApi(app, '/v1/moderation/changes').expect(401);
    const response = await getJsonApi(app, '/v1/moderation/changes', luis.accessToken).expect(403);
    expect(response.body.errors[0].code).toBe('staff_required');
  });
});
