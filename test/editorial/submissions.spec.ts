import { DataSource } from 'typeorm';
import { accessTokenFor, register, setAccountStatus, updateProfile } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  createProposal,
  discardProposal,
  draftIdentityCreation,
  getJsonApi,
  personCreation,
  removeChange,
  removeSource,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
  updateChange,
  updateProposal,
  updateSource,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('submissions', () => {
  let app: TestApp;
  let diego: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    diego = await registerVerified(app, 'diego_papi');
  });

  afterAll(async () => {
    await app.close();
  });

  const codes = (body: { errors: { code?: string }[] }) => body.errors.map((error) => error.code);

  describe('POST /v1/proposals/{id}/submission', () => {
    it('submits a complete draft, which becomes open', async () => {
      const { proposalId } = await draftIdentityCreation(app, diego.accessToken);
      app.clock.advance(MINUTE);

      const response = await submitProposal(app, diego.accessToken, proposalId).expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          type: 'proposals',
          id: proposalId,
          attributes: expect.objectContaining({ status: 'open', submittedAt: '2026-01-01T00:01:00.000Z', closedAt: null }),
        }),
      );
      expect(response.body.links).toEqual({ self: `/v1/proposals/${proposalId}` });
    });

    it('requires a description, a microchange and a general source', async () => {
      const proposalId = await createDraft(app, diego.accessToken, '');

      const response = await submitProposal(app, diego.accessToken, proposalId).expect(422);

      expect(codes(response.body)).toEqual(['description_required', 'changes_required', 'sources_required']);
      const draft = await getJsonApi(app, `/v1/proposals/${proposalId}`, diego.accessToken).expect(200);
      expect(draft.body.data.attributes.status).toBe('draft');
    });

    it('validates every payload again, naming the microchange', async () => {
      const { proposalId, changeId } = await draftIdentityCreation(app, diego.accessToken);
      // The origin country is deleted after the microchange was added.
      const [{ id: countryId }] = await app.app
        .get(DataSource)
        .query(`INSERT INTO countries (code, name) VALUES ('KR', 'Corea del Sur') RETURNING id`);
      const organization = { exists: true, value: { type: 'organization', displayName: 'EDAM', organization: { originCountryId: countryId } } };
      await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue: organization }).expect(200);
      await app.app.get(DataSource).query('DELETE FROM countries');

      const response = await submitProposal(app, diego.accessToken, proposalId).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({
          code: 'unknown_vocabulary_entry',
          meta: { changeId, member: 'proposedValue/value/organization/originCountryId' },
        }),
      ]);
    });

    it('lets only the first submission of a reservation through', async () => {
      const entityId = await reserveIdentity(app, diego.accessToken);
      const drafts = [];
      for (const description of ['Primera', 'Segunda']) {
        const proposalId = await createDraft(app, diego.accessToken, description);
        await addChange(app, diego.accessToken, proposalId, { entityId }).expect(201);
        await addSource(app, diego.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
        drafts.push(proposalId);
      }

      const responses = await Promise.all(drafts.map((proposalId) => submitProposal(app, diego.accessToken, proposalId)));

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 422]);
      expect(codes(responses.find(({ status }) => status === 422)!.body)).toEqual(['reservation_claimed']);
    });

    it('submits a draft once when two submissions race', async () => {
      const { proposalId } = await draftIdentityCreation(app, diego.accessToken);

      const responses = await Promise.all([1, 2].map(() => submitProposal(app, diego.accessToken, proposalId)));

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    });

    it('freezes the content: every edit answers 409', async () => {
      const { proposalId, changeId, sourceId } = await submitIdentityCreation(app, diego.accessToken);

      for (const response of [
        await submitProposal(app, diego.accessToken, proposalId),
        await updateProposal(app, diego.accessToken, proposalId, { description: 'Otra' }),
        await discardProposal(app, diego.accessToken, proposalId),
        await addChange(app, diego.accessToken, proposalId, { entityId: await reserveIdentity(app, diego.accessToken) }),
        await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue: personCreation({ displayName: 'Otra' }) }),
        await removeChange(app, diego.accessToken, proposalId, changeId),
        await addSource(app, diego.accessToken, proposalId, { citationText: 'Otra' }),
        await updateSource(app, diego.accessToken, proposalId, sourceId, { citationText: 'Otra' }),
        await removeSource(app, diego.accessToken, proposalId, sourceId),
      ]) {
        expect(response.status).toBe(409);
        expect(codes(response.body)).toEqual(['proposal_submitted']);
      }
      const response = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes,sources`).expect(200);
      expect(response.body.data.attributes.description).toBe('Alta de IU con su perfil de Wikipedia');
      expect(response.body.included).toEqual([
        expect.objectContaining({ id: changeId, attributes: expect.objectContaining({ proposedValue: personCreation(), position: 0 }) }),
        expect.objectContaining({ id: sourceId, attributes: expect.objectContaining({ url: WIKIPEDIA }) }),
      ]);
    });

    it('refuses edits of a submission by anyone but its author with 403', async () => {
      const { proposalId } = await submitIdentityCreation(app, diego.accessToken);
      const other = await registerVerified(app, 'otra_cuenta');

      await updateProposal(app, other.accessToken, proposalId, { description: 'Otra' }).expect(403);
      await submitProposal(app, other.accessToken, proposalId).expect(403);
    });

    it('requires a verified, active author', async () => {
      const { proposalId } = await draftIdentityCreation(app, diego.accessToken);
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');

      await submitProposal(app, diego.accessToken, proposalId).expect(401);

      await register(app.server, { username: 'sin_verificar', email: 'sin@example.com' }).expect(201);
      await submitProposal(app, await accessTokenFor(app.server, 'sin_verificar'), proposalId).expect(403);
    });

    it('links a correction to an earlier submission of the same author only', async () => {
      const { proposalId } = await submitIdentityCreation(app, diego.accessToken);
      const draftId = await createDraft(app, diego.accessToken);
      const other = await registerVerified(app, 'otra_cuenta');
      const previousProposal = (id: string) => ({ previousProposal: { data: { type: 'proposals', id } } });

      const response = await createProposal(app, diego.accessToken, { description: 'Corrección' }, previousProposal(proposalId)).expect(201);
      expect(response.body.data.relationships.previousProposal).toEqual({ data: { type: 'proposals', id: proposalId } });

      await createProposal(app, diego.accessToken, {}, previousProposal(draftId)).expect(422);
      await createProposal(app, other.accessToken, {}, previousProposal(proposalId)).expect(422);
    });
  });

  describe('public views of a submission', () => {
    it('shows the submission to anyone as proposed information, without the outcome of each microchange', async () => {
      const { proposalId, changeId, sourceId, entityId } = await submitIdentityCreation(app, diego.accessToken);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}?include=author,changes,sources`).expect(200);

      expect(response.body.meta).toEqual({ informationKind: 'proposed' });
      expect(response.body.data).toEqual({
        type: 'proposals',
        id: proposalId,
        attributes: {
          description: 'Alta de IU con su perfil de Wikipedia',
          status: 'open',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          submittedAt: '2026-01-01T00:00:00.000Z',
          closedAt: null,
        },
        relationships: {
          author: { data: { type: 'users', id: diego.uuid } },
          previousProposal: { data: null },
          changes: { data: [{ type: 'proposal-changes', id: changeId }] },
          sources: { data: [{ type: 'proposal-sources', id: sourceId }] },
        },
      });
      const change = response.body.included.find((resource: { type: string }) => resource.type === 'proposal-changes');
      expect(change.attributes).toEqual({
        operation: 'create_entity',
        targetPath: 'catalog_identities',
        targetKey: null,
        payloadSchemaVersion: 1,
        baseVersion: 0,
        baseValue: { exists: false },
        proposedValue: personCreation(),
        atomicGroupId: null,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(change.relationships).toEqual({
        entity: { data: { type: 'editorial-entities', id: entityId } },
        dependencies: { data: [] },
        sources: { data: [] },
      });
      const author = response.body.included.find((resource: { type: string }) => resource.type === 'users');
      expect(author.attributes.username).toBe('diego_papi');
      expect(author.attributes).not.toHaveProperty('email');
    });

    it('shows the states of the microchanges to the author and to staff, and hides them from other accounts', async () => {
      const { proposalId } = await submitIdentityCreation(app, diego.accessToken);
      const admin = await registerFirstAdmin(app);
      const moderator = await registerVerified(app, 'moderadora');
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      const other = await registerVerified(app, 'otra_cuenta');
      const statuses = async (token?: string) =>
        (await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, token).expect(200)).body.data.map(
          (change: { attributes: { status?: string } }) => change.attributes.status,
        );

      expect(await statuses(diego.accessToken)).toEqual(['pending']);
      expect(await statuses(admin.accessToken)).toEqual(['pending']);
      expect(await statuses(moderator.accessToken)).toEqual(['pending']);
      expect(await statuses(other.accessToken)).toEqual([undefined]);
      expect(await statuses()).toEqual([undefined]);
    });

    it('lists the submission in the public history of its root, which stays private as a reservation', async () => {
      const { proposalId, entityId } = await submitIdentityCreation(app, diego.accessToken);
      await createDraft(app, diego.accessToken);

      const response = await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals?include=changes,sources`).expect(200);

      expect(response.body.meta).toEqual({ total: 1, informationKind: 'proposed' });
      expect(response.body.data.map((proposal: { id: string }) => proposal.id)).toEqual([proposalId]);
      const change = response.body.included.find((resource: { type: string }) => resource.type === 'proposal-changes');
      expect(change.attributes).not.toHaveProperty('status');
      expect(change.attributes).not.toHaveProperty('resolvedAt');
      // The reservation itself is not a public entry yet.
      await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(404);
    });

    it('keeps the history of a reservation without submissions private, and never lists drafts', async () => {
      const { entityId } = await draftIdentityCreation(app, diego.accessToken);
      const other = await registerVerified(app, 'otra_cuenta');

      await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals`).expect(404);
      await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals`, other.accessToken).expect(404);
      const own = await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals`, diego.accessToken).expect(200);
      expect(own.body.data).toEqual([]);
      await getJsonApi(app, '/v1/editorial-entities/00000000-0000-4000-8000-000000000000/proposals').expect(404);
    });

    it('attributes the submission to the current username of its author', async () => {
      const { proposalId } = await submitIdentityCreation(app, diego.accessToken);
      app.clock.advance(8 * 24 * 60 * MINUTE);
      const accessToken = await accessTokenFor(app.server, 'diego_papi');
      await updateProfile(app.server, accessToken, diego.uuid, { username: 'diego_nuevo' }).expect(200);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}?include=author`).expect(200);

      expect(response.body.included).toEqual([
        expect.objectContaining({ id: diego.uuid, attributes: expect.objectContaining({ username: 'diego_nuevo' }) }),
      ]);
    });

    it('keeps the submissions of a suspended author public', async () => {
      const { proposalId } = await submitIdentityCreation(app, diego.accessToken);
      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');

      await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
    });
  });
});
