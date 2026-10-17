import { DataSource } from 'typeorm';
import { accessTokenFor, register, sendJsonApi, setAccountStatus } from '../support/accounts';
import { Account, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  addChange,
  createDraft,
  createProposal,
  discardProposal,
  draftIdentityCreation,
  getJsonApi,
  updateProposal,
} from '../support/editorial';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('drafts', () => {
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

  describe('POST /v1/proposals', () => {
    it('creates a private draft authored by the account', async () => {
      const response = await createProposal(app, diego.accessToken, { description: '  Alta de IU  ' }).expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      const { id } = response.body.data;
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'proposals',
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          attributes: {
            description: 'Alta de IU',
            status: 'draft',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            submittedAt: null,
            closedAt: null,
          },
          relationships: {
            author: { data: { type: 'users', id: diego.uuid } },
            previousProposal: { data: null },
          },
        },
        links: { self: `/v1/proposals/${id}` },
        meta: { informationKind: 'proposed' },
      });
    });

    it('accepts a draft whose description is still to be written', async () => {
      const response = await createProposal(app, diego.accessToken).expect(201);

      expect(response.body.data.attributes.description).toBe('');
    });

    it('validates the description', async () => {
      const response = await createProposal(app, diego.accessToken, { description: 'x'.repeat(10_001) }).expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/attributes/description' } })]);
    });

    it('requires a verified, active account', async () => {
      await register(app.server, { username: 'sin_verificar', email: 'sin@example.com' }).expect(201);
      await createProposal(app, await accessTokenFor(app.server, 'sin_verificar')).expect(403);

      await setAccountStatus(app.app.get(DataSource), 'diego_papi', 'suspended');
      await createProposal(app, diego.accessToken).expect(401);
    });
  });

  describe('GET /v1/proposals/{id}', () => {
    it('shows a draft to its author, with its microchanges and their states', async () => {
      const { proposalId, entityId, changeId, sourceId } = await draftIdentityCreation(app, diego.accessToken);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes,sources`, diego.accessToken).expect(200);

      expect(response.body.data.relationships).toEqual({
        author: { data: { type: 'users', id: diego.uuid } },
        previousProposal: { data: null },
        changes: { data: [{ type: 'proposal-changes', id: changeId }] },
        sources: { data: [{ type: 'proposal-sources', id: sourceId }] },
      });
      const change = response.body.included.find((resource: { type: string }) => resource.type === 'proposal-changes');
      expect(change.attributes).toEqual(expect.objectContaining({ status: 'pending', resolvedAt: null }));
      expect(change.relationships.entity).toEqual({ data: { type: 'editorial-entities', id: entityId } });
    });

    it('answers 404 for a draft to anyone else, staff included', async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      const admin = await registerFirstAdmin(app);
      const other = await registerVerified(app, 'otra_cuenta');

      for (const token of [undefined, other.accessToken, admin.accessToken]) {
        await getJsonApi(app, `/v1/proposals/${proposalId}`, token).expect(404);
        await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, token).expect(404);
      }
    });

    it('answers 404 for unknown ids', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        await getJsonApi(app, `/v1/proposals/${id}`, diego.accessToken).expect(404);
      }
    });
  });

  describe('PATCH /v1/proposals/{id}', () => {
    it('edits the description of a draft', async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      app.clock.advance(MINUTE);

      const response = await updateProposal(app, diego.accessToken, proposalId, { description: 'Alta de IU, corregida' }).expect(200);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({ description: 'Alta de IU, corregida', updatedAt: '2026-01-01T00:01:00.000Z' }),
      );
    });

    it('answers 404 to anyone but the author, staff included', async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      const admin = await registerFirstAdmin(app);

      await updateProposal(app, admin.accessToken, proposalId, { description: 'Otra' }).expect(404);
    });

    it('refuses a body whose id is not the proposal in the URL', async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      const other = await createDraft(app, diego.accessToken);

      const response = await sendJsonApi(app.server, 'patch', `/v1/proposals/${proposalId}`, {
        data: { type: 'proposals', id: other, attributes: { description: 'Otra' } },
      })
        .set('Authorization', `Bearer ${diego.accessToken}`)
        .expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'id_mismatch' })]);
    });
  });

  describe('DELETE /v1/proposals/{id}', () => {
    it('discards a draft with its microchanges and sources, without any moderation decision', async () => {
      const { proposalId, entityId } = await draftIdentityCreation(app, diego.accessToken);

      await discardProposal(app, diego.accessToken, proposalId).expect(204);

      await getJsonApi(app, `/v1/proposals/${proposalId}`, diego.accessToken).expect(404);
      const [{ count }] = await app.app.get(DataSource).query('SELECT count(*)::int AS count FROM change_decisions');
      expect(count).toBe(0);
      // The reservation remains, abandoned and still private; a new draft may use it.
      await getJsonApi(app, `/v1/editorial-entities/${entityId}`, diego.accessToken).expect(200);
      await addChange(app, diego.accessToken, await createDraft(app, diego.accessToken), { entityId }).expect(201);
    });

    it('answers 404 to anyone but the author, staff included', async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      const admin = await registerFirstAdmin(app);

      await discardProposal(app, admin.accessToken, proposalId).expect(404);
      await getJsonApi(app, `/v1/proposals/${proposalId}`, diego.accessToken).expect(200);
    });
  });
});
