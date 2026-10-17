import { Account, registerVerified } from '../support/administration';
import {
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  draftIdentityCreation,
  getJsonApi,
  personCreation,
  removeChange,
  removeSource,
  reserveIdentity,
  submitIdentityCreation,
  updateChange,
  updateSource,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { DataSource } from 'typeorm';

describe('microchanges and sources of a draft', () => {
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

  const pointers = (body: { errors: { source?: { pointer?: string } }[] }) => body.errors.map((error) => error.source?.pointer);

  describe('POST /v1/proposals/{id}/changes', () => {
    it('adds the creation of a reserved identity, based on its absence at version 0', async () => {
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId }).expect(201);

      const { id } = response.body.data;
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: {
          type: 'proposal-changes',
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          attributes: {
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
            status: 'pending',
            resolvedAt: null,
          },
          relationships: { entity: { data: { type: 'editorial-entities', id: entityId } } },
        },
        links: { self: `/v1/proposals/${proposalId}/changes/${id}` },
        meta: { informationKind: 'proposed' },
      });
    });

    it('creates an organization with a partial founding date and an origin country', async () => {
      const [{ id: countryId }] = await app.app
        .get(DataSource)
        .query(`INSERT INTO countries (code, name) VALUES ('KR', 'Corea del Sur') RETURNING id`);
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);
      const proposedValue = {
        exists: true,
        value: { type: 'organization', displayName: 'BLACKPINK', organization: { founding: { year: 2016, month: 8 }, originCountryId: countryId } },
      };

      await addChange(app, diego.accessToken, proposalId, { entityId, proposedValue }).expect(201);
    });

    it.each([
      ['an unknown operation', { operation: 'drop_table' }, '/data/attributes/operation'],
      ['an operation outside the registry', { operation: 'withdraw_entity' }, '/data/attributes/operation'],
      ['a selector naming an arbitrary table', { targetPath: 'users' }, '/data/attributes/targetPath'],
      ['a selector with SQL', { targetPath: 'catalog_identities; DROP TABLE users' }, '/data/attributes/targetPath'],
      ['an unknown payload version', { payloadSchemaVersion: 2 }, '/data/attributes/payloadSchemaVersion'],
      ['a row key for a root operation', { targetKey: { id: 1 } }, '/data/attributes/targetKey'],
    ])('refuses %s', async (_, input, pointer) => {
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId, ...input }).expect(422);

      expect(pointers(response.body)).toEqual([pointer]);
    });

    it.each([
      ['no subtype', personCreation({ person: undefined }), '/data/attributes/proposedValue/value/person'],
      [
        'the other subtype too',
        personCreation({ organization: {} }),
        '/data/attributes/proposedValue/value/organization',
      ],
      ['a blank display name', personCreation({ displayName: '   ' }), '/data/attributes/proposedValue/value/displayName'],
      ['an unknown member', personCreation({ isAdmin: true }), '/data/attributes/proposedValue/value/isAdmin'],
      [
        'an impossible birth date',
        personCreation({ person: { birthDate: '1993-02-30' } }),
        '/data/attributes/proposedValue/value/person/birthDate',
      ],
      [
        'a death before birth',
        personCreation({ person: { birthDate: '1993-05-16', deathDate: '1990-01-01' } }),
        '/data/attributes/proposedValue/value/person/deathDate',
      ],
      ['a removal instead of a creation', { exists: false }, '/data/attributes/proposedValue/exists'],
      [
        'a day without its month',
        { exists: true, value: { type: 'organization', displayName: 'X', organization: { founding: { year: 2016, day: 3 } } } },
        '/data/attributes/proposedValue/value/organization/founding',
      ],
      [
        'a dissolution before the founding',
        {
          exists: true,
          value: { type: 'organization', displayName: 'X', organization: { founding: { year: 2016 }, dissolution: { year: 2015, month: 12 } } },
        },
        '/data/attributes/proposedValue/value/organization/dissolution',
      ],
      [
        'an unknown origin country',
        { exists: true, value: { type: 'organization', displayName: 'X', organization: { originCountryId: 999 } } },
        '/data/attributes/proposedValue/value/organization/originCountryId',
      ],
    ])('refuses a payload with %s', async (_, proposedValue, pointer) => {
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId, proposedValue }).expect(422);

      expect(pointers(response.body)).toContain(pointer);
    });

    it("refuses another author's reservation as if it did not exist", async () => {
      const other = await registerVerified(app, 'otra_cuenta');
      const entityId = await reserveIdentity(app, other.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'editorial_entity_not_found', source: { pointer: '/data/relationships/entity/data/id' } }),
      ]);
    });

    it('refuses to create the same root twice in one proposal', async () => {
      const { proposalId, entityId } = await draftIdentityCreation(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId }).expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'overlapping_change' })]);
    });

    it('refuses a reservation another submission already proposes', async () => {
      const { entityId } = await submitIdentityCreation(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId }).expect(422);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'reservation_claimed' })]);
    });

    it('orders microchanges after the last one and refuses a taken position', async () => {
      const { proposalId } = await draftIdentityCreation(app, diego.accessToken);
      const entityId = await reserveIdentity(app, diego.accessToken);

      await addChange(app, diego.accessToken, proposalId, { entityId, position: 0 }).expect(422);
      const response = await addChange(app, diego.accessToken, proposalId, { entityId }).expect(201);

      expect(response.body.data.attributes.position).toBe(1);
    });

    it("answers 404 for another account's draft", async () => {
      const proposalId = await createDraft(app, diego.accessToken);
      const other = await registerVerified(app, 'otra_cuenta');
      const entityId = await reserveIdentity(app, other.accessToken);

      await addChange(app, other.accessToken, proposalId, { entityId }).expect(404);
    });
  });

  describe('PATCH and DELETE /v1/proposals/{id}/changes/{changeId}', () => {
    it('edits the payload and position of a microchange, validating them again', async () => {
      const { proposalId, changeId } = await draftIdentityCreation(app, diego.accessToken);
      const atomicGroupId = '6f1c1c6e-4c1e-4f7a-9d55-0c9a3b7e2f10';

      const response = await updateChange(app, diego.accessToken, proposalId, changeId, {
        proposedValue: personCreation({ displayName: '아이유' }),
        position: 5,
        atomicGroupId,
      }).expect(200);

      expect(response.body.data.attributes).toEqual(
        expect.objectContaining({ proposedValue: personCreation({ displayName: '아이유' }), position: 5, atomicGroupId }),
      );
      await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue: { exists: true, value: {} } }).expect(422);
    });

    it('removes a microchange', async () => {
      const { proposalId, changeId } = await draftIdentityCreation(app, diego.accessToken);

      await removeChange(app, diego.accessToken, proposalId, changeId).expect(204);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, diego.accessToken).expect(200);
      expect(response.body.data).toEqual([]);
      await removeChange(app, diego.accessToken, proposalId, changeId).expect(404);
    });
  });

  describe('GET /v1/proposals/{id}/changes', () => {
    it('lists the microchanges of a draft in order, with their states, to its author', async () => {
      const { proposalId, changeId } = await draftIdentityCreation(app, diego.accessToken);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, diego.accessToken).expect(200);

      expect(response.body.meta).toEqual({ total: 1, informationKind: 'proposed' });
      expect(response.body.data).toEqual([
        expect.objectContaining({ id: changeId, attributes: expect.objectContaining({ status: 'pending' }) }),
      ]);
    });
  });

  describe('sources', () => {
    it.each([
      [{ url: WIKIPEDIA }],
      [{ citationText: 'Revista Hanteo, n.º 12, p. 4' }],
      [{ url: 'http://example.com/iu', citationText: 'Comunicado de EDAM' }],
    ])('adds a source with a URL, a citation or both (%j)', async (attributes) => {
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addSource(app, diego.accessToken, proposalId, attributes).expect(201);

      expect(response.body.data).toEqual({
        type: 'proposal-sources',
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        attributes: { url: null, citationText: null, ...attributes, createdAt: '2026-01-01T00:00:00.000Z' },
      });
    });

    it.each([
      [{}, '/data/attributes'],
      [{ url: '   ', citationText: '' }, '/data/attributes'],
      [{ url: 'ftp://example.com/iu' }, '/data/attributes/url'],
      [{ url: 'javascript:alert(1)' }, '/data/attributes/url'],
      [{ url: 'not a url' }, '/data/attributes/url'],
    ])('refuses a source without a valid reference (%j)', async (attributes, pointer) => {
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addSource(app, diego.accessToken, proposalId, attributes).expect(422);

      expect(pointers(response.body)).toEqual([pointer]);
    });

    it('edits a source as long as it keeps a URL or a citation, and removes it', async () => {
      const { proposalId, sourceId } = await draftIdentityCreation(app, diego.accessToken);

      const edited = await updateSource(app, diego.accessToken, proposalId, sourceId, { citationText: 'Wikipedia' }).expect(200);
      expect(edited.body.data.attributes).toEqual(expect.objectContaining({ url: WIKIPEDIA, citationText: 'Wikipedia' }));
      await updateSource(app, diego.accessToken, proposalId, sourceId, { url: null }).expect(200);
      await updateSource(app, diego.accessToken, proposalId, sourceId, { citationText: null }).expect(422);

      await removeSource(app, diego.accessToken, proposalId, sourceId).expect(204);
      await removeSource(app, diego.accessToken, proposalId, sourceId).expect(404);
    });
  });
});
