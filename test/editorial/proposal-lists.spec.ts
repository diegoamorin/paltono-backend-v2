import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { setAccountStatus } from '../support/accounts';
import { createDraft, decideChange, draftIdentityCreation, getJsonApi, submitIdentityCreation } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60_000;

describe('lists of proposals by account', () => {
  let app: TestApp;
  let moderator: Account;
  let diego: Account;
  let ana: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    const admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    diego = await registerVerified(app, 'diego_papi');
    ana = await registerVerified(app, 'ana');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Diego's proposals: a closed submission, an open one and a draft, one minute apart; and one of Ana. */
  async function seedProposals() {
    const closed = await submitIdentityCreation(app, diego.accessToken);
    await decideChange(app, moderator.accessToken, closed.changeId, { action: 'apply' }).expect(201);
    app.clock.advance(MINUTE);
    const open = await submitIdentityCreation(app, diego.accessToken);
    app.clock.advance(MINUTE);
    const draft = await draftIdentityCreation(app, diego.accessToken);
    app.clock.advance(MINUTE);
    const others = await submitIdentityCreation(app, ana.accessToken);
    return { closed, open, draft, others };
  }

  const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

  describe('GET /v1/me/proposals (E7)', () => {
    it('lists the own proposals, drafts included, last updated first, with the state of each microchange', async () => {
      const { closed, open, draft } = await seedProposals();

      const response = await getJsonApi(app, '/v1/me/proposals?include=changes', diego.accessToken).expect(200);

      expect(ids(response.body)).toEqual([draft.proposalId, open.proposalId, closed.proposalId]);
      expect(response.body.meta).toEqual({ total: 3, informationKind: 'proposed' });
      expect(response.body.data.map(({ attributes }: { attributes: { status: string } }) => attributes.status)).toEqual(['draft', 'open', 'closed']);
      const states = response.body.included.map(({ id, attributes }: { id: string; attributes: { status: string } }) => [id, attributes.status]);
      expect(states).toEqual(expect.arrayContaining([[closed.changeId, 'applied'], [open.changeId, 'pending'], [draft.changeId, 'pending']]));
    });

    it('filters by status, root and type of root, and sorts by submission', async () => {
      const { closed, open, draft } = await seedProposals();
      const list = async (query: string) => ids((await getJsonApi(app, `/v1/me/proposals?${query}`, diego.accessToken).expect(200)).body);

      expect(await list('filter[status]=draft')).toEqual([draft.proposalId]);
      expect(await list('filter[status]=open,closed')).toEqual([open.proposalId, closed.proposalId]);
      expect(await list(`filter[entity]=${closed.entityId.toUpperCase()}`)).toEqual([closed.proposalId]);
      expect(await list('filter[entityType]=identity')).toHaveLength(3);
      expect(await list('filter[entityType]=work')).toEqual([]);
      expect(await list('filter[status]=open,closed&sort=-submittedAt')).toEqual([open.proposalId, closed.proposalId]);
    });

    it('rejects filters and sorts outside the allowed ones', async () => {
      for (const query of [
        'filter[status]=pending',
        'filter[entityType]=song',
        'filter[entity]=not-a-uuid',
        'filter[author]=x',
        'sort=description',
        'sort=submittedAt',
        'sort=updatedAt',
      ]) {
        await getJsonApi(app, `/v1/me/proposals?${query}`, diego.accessToken).expect(400);
      }
    });

    it('requires an active, verified account', async () => {
      await getJsonApi(app, '/v1/me/proposals').expect(401);
      await setAccountStatus(app.app.get(DataSource), diego.username, 'suspended');
      await getJsonApi(app, '/v1/me/proposals', diego.accessToken).expect(401);
    });
  });

  describe('GET /v1/users/{id}/proposals (A19)', () => {
    it('lists the submissions of an account in the public projection, never its drafts', async () => {
      const { closed, open } = await seedProposals();

      for (const viewer of [undefined, diego.accessToken, moderator.accessToken]) {
        const response = await getJsonApi(app, `/v1/users/${diego.uuid}/proposals?include=changes`, viewer).expect(200);

        expect(ids(response.body)).toEqual([open.proposalId, closed.proposalId]);
        expect(response.body.meta).toEqual({ total: 2, informationKind: 'proposed' });
        expect(response.body.data[1].attributes.status).toBe('closed');
        for (const change of response.body.included) {
          expect(change.attributes).not.toHaveProperty('status');
          expect(change.attributes).not.toHaveProperty('resolvedAt');
        }
      }
    });

    it('filters by status and type of root, and sorts by submission', async () => {
      const { closed, open } = await seedProposals();
      const list = async (query: string) => ids((await getJsonApi(app, `/v1/users/${diego.uuid}/proposals?${query}`).expect(200)).body);

      expect(await list('filter[status]=closed')).toEqual([closed.proposalId]);
      expect(await list('sort=submittedAt')).toEqual([closed.proposalId, open.proposalId]);
      expect(await list('filter[entityType]=work')).toEqual([]);
      await getJsonApi(app, `/v1/users/${diego.uuid}/proposals?filter[status]=draft`).expect(400);
      await getJsonApi(app, `/v1/users/${diego.uuid}/proposals?filter[entity]=${closed.entityId}`).expect(400);
    });

    it('keeps listing the submissions of a suspended account', async () => {
      const { closed, open } = await seedProposals();
      await setAccountStatus(app.app.get(DataSource), diego.username, 'suspended');

      const response = await getJsonApi(app, `/v1/users/${diego.uuid}/proposals`).expect(200);

      expect(ids(response.body)).toEqual([open.proposalId, closed.proposalId]);
    });

    it('answers 404 for an unknown account', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const response = await getJsonApi(app, `/v1/users/${id}/proposals`).expect(404);
        expect(response.body.errors[0].code).toBe('account_not_found');
      }
    });

    it('shows an account without submissions as an empty list', async () => {
      await createDraft(app, ana.accessToken);

      const response = await getJsonApi(app, `/v1/users/${ana.uuid}/proposals`).expect(200);

      expect(response.body.data).toEqual([]);
    });
  });
});
