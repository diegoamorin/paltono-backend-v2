import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { setAccountStatus } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  draftIdentityCreation,
  getJsonApi,
  personCreation,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
  updateChange,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

const organizationCreation = (organization: object = {}) => ({
  exists: true,
  value: { type: 'organization', displayName: 'EDAM', organization },
});

describe('decisions', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let diego: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    diego = await registerVerified(app, 'diego_papi');
  });

  afterAll(async () => {
    await app.close();
  });

  /** The review state of each microchange of a proposal, as its author sees it. */
  async function statuses(proposalId: string): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, diego.accessToken).expect(200);
    return body.data.map((change: { attributes: { status: string } }) => change.attributes.status);
  }

  /** The editorial state of a root, as its creator sees it. */
  async function rootState(entityId: string) {
    const { body } = await getJsonApi(app, `/v1/editorial-entities/${entityId}`, diego.accessToken).expect(200);
    return body.data.attributes;
  }

  /** Submits one proposal creating a root for each value. */
  async function submitCreations(values: object[]): Promise<{ proposalId: string; changeIds: string[] }> {
    const proposalId = await createDraft(app, diego.accessToken, 'Altas de la prueba');
    const changeIds: string[] = [];
    for (const proposedValue of values) {
      const entityId = await reserveIdentity(app, diego.accessToken);
      const { body } = await addChange(app, diego.accessToken, proposalId, { entityId, proposedValue }).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, diego.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, diego.accessToken, proposalId).expect(200);
    return { proposalId, changeIds };
  }

  describe('POST /v1/proposal-changes/{id}/decisions', () => {
    it('publishes a minimal identity creation with its first revision', async () => {
      const { entityId, proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      app.clock.advance(MINUTE);

      const response = await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision').expect(201);

      const [decision] = response.body.data;
      expect(decision).toEqual({
        type: 'change-decisions',
        id: expect.any(String),
        attributes: {
          action: 'apply',
          previousStatus: 'pending',
          resultingStatus: 'applied',
          reason: null,
          observedVersion: 0,
          observedValue: { exists: false },
          decidedAt: '2026-01-01T00:01:00.000Z',
        },
        relationships: {
          change: { data: { type: 'proposal-changes', id: changeId } },
          actor: { data: { type: 'users', id: moderator.uuid } },
          revision: { data: { type: 'entity-revisions', id: expect.any(String) } },
        },
      });
      const [revision] = response.body.included;
      expect(revision.attributes).toEqual(
        expect.objectContaining({ version: 1, beforeValue: { exists: false }, appliedAt: '2026-01-01T00:01:00.000Z' }),
      );
      const { publicId } = revision.attributes.resultKey;

      const identity = await getJsonApi(app, `/v1/identities/${publicId}`).expect(200);
      expect(identity.body.data).toEqual({
        type: 'identities',
        id: publicId,
        attributes: {
          publicationStatus: 'published',
          withdrawnAt: null,
          type: 'person',
          displayName: 'IU',
          imgProfile: null,
          bio: 'Cantante y actriz surcoreana.',
          person: { givenName: 'Ji-eun', familyName: 'Lee', birthDate: '1993-05-16', birthCountryId: null, deathDate: null, heightCm: 162, gender: 'female' },
          organization: null,
          createdAt: '2026-01-01T00:01:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
        },
        relationships: {
          aliases: { data: [] },
          nationalities: { data: [] },
          birthCountry: { data: null },
          originCountry: { data: null },
          organizationTypes: { data: [] },
          platformLinks: { data: [] },
          artist: { data: null },
        },
        meta: { editorialEntityId: entityId },
      });
      const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(root.body.data.attributes).toEqual(
        expect.objectContaining({ publicationStatus: 'published', currentVersion: 1, publishedAt: '2026-01-01T00:01:00.000Z' }),
      );
      const proposal = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(proposal.body.data.attributes).toEqual(
        expect.objectContaining({ status: 'closed', closedAt: '2026-01-01T00:01:00.000Z' }),
      );
      expect(await statuses(proposalId)).toEqual(['applied']);
    });

    it('publishes a minimal organization, with partial dates at their known precision', async () => {
      const { changeIds } = await submitCreations([organizationCreation({ founding: { year: 2015 } })]);

      const response = await decideChange(app, admin.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

      const [revision] = response.body.included;
      expect(revision.attributes.afterValue).toEqual({
        exists: true,
        value: {
          type: 'organization',
          displayName: 'EDAM',
          imgProfile: null,
          bio: null,
          organization: { legalName: null, founding: { year: 2015 }, dissolution: null, originCountryId: null },
        },
      });
      const identity = await getJsonApi(app, `/v1/identities/${revision.attributes.resultKey.publicId}`).expect(200);
      expect(identity.body.data.attributes).toEqual(
        expect.objectContaining({
          type: 'organization',
          person: null,
          organization: { legalName: null, founding: { year: 2015, month: null, day: null }, dissolution: null, originCountryId: null },
        }),
      );
    });

    it('rejects with a reason, leaving the reservation without a public entry', async () => {
      const { entityId, proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);

      const response = await decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason: 'Sin fuentes fiables' }).expect(201);

      expect(response.body.data[0].attributes).toEqual(
        expect.objectContaining({ action: 'reject', resultingStatus: 'rejected', reason: 'Sin fuentes fiables' }),
      );
      expect(response.body.data[0].relationships.revision).toEqual({ data: null });
      expect(await rootState(entityId)).toEqual(expect.objectContaining({ publicationStatus: 'reserved', currentVersion: 0 }));
      await getJsonApi(app, `/v1/editorial-entities/${entityId}`, moderator.accessToken).expect(404);
      expect(await statuses(proposalId)).toEqual(['rejected']);
      const proposal = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(proposal.body.data.attributes.status).toBe('closed');
    });

    it('requires a reason to reject', async () => {
      const { proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);

      for (const reason of [undefined, null, '   ']) {
        const response = await decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason }).expect(422);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'reason_required', source: { pointer: '/data/attributes/reason' } }),
        ]);
      }
      expect(await statuses(proposalId)).toEqual(['pending']);
    });

    it('accepts only the manual actions', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);

      const response = await decideChange(app, moderator.accessToken, changeId, { action: 'mark_satisfied' }).expect(422);

      expect(response.body.errors[0].source).toEqual({ pointer: '/data/attributes/action' });
    });

    it('keeps the proposal open until every microchange is resolved', async () => {
      const { proposalId, changeIds } = await submitCreations([personCreation(), organizationCreation()]);

      await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }).expect(201);
      const open = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(open.body.data.attributes).toEqual(expect.objectContaining({ status: 'open', closedAt: null }));

      app.clock.advance(MINUTE);
      await decideChange(app, moderator.accessToken, changeIds[1], { action: 'reject', reason: 'Duplicada' }).expect(201);
      const closed = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(closed.body.data.attributes).toEqual(expect.objectContaining({ status: 'closed', closedAt: '2026-01-01T00:01:00.000Z' }));
      expect(await statuses(proposalId)).toEqual(['applied', 'rejected']);
    });

    it('never reopens a resolved microchange', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);
      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);

      for (const attributes of [{ action: 'apply' }, { action: 'reject', reason: 'Tarde' }]) {
        const response = await decideChange(app, admin.accessToken, changeId, attributes).expect(409);
        expect(response.body.errors[0].code).toBe('change_resolved');
      }
    });

    it('applies once when two moderators decide at the same time', async () => {
      const { entityId, changeId } = await submitIdentityCreation(app, diego.accessToken);

      const responses = await Promise.all(
        [moderator, admin].map((account) => decideChange(app, account.accessToken, changeId, { action: 'apply' })),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect((await rootState(entityId)).currentVersion).toBe(1);
      const history = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, admin.accessToken).expect(200);
      expect(history.body.meta.total).toBe(1);
    });

    it('refuses to publish for anyone without a staff role, without writing anything', async () => {
      const { entityId, proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      const ana = await registerVerified(app, 'ana');

      for (const [account, attributes] of [
        [diego, { action: 'apply' }],
        [ana, { action: 'apply' }],
        [ana, { action: 'reject', reason: 'No me gusta' }],
      ] as const) {
        const response = await decideChange(app, account.accessToken, changeId, attributes).expect(403);
        expect(response.body.errors[0].code).toBe('staff_required');
      }

      expect(await statuses(proposalId)).toEqual(['pending']);
      expect((await rootState(entityId)).publicationStatus).toBe('reserved');
      const history = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, diego.accessToken).expect(200);
      expect(history.body.data).toEqual([]);
    });

    it('rereads the role of the acting account: a demoted moderator cannot decide', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'user', reason: 'Fin de la moderación' }).expect(201);

      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(403);
    });

    it('only lets active accounts decide', async () => {
      const { proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      await setAccountStatus(app.app.get(DataSource), moderator.username, 'suspended');

      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(401);
      expect(await statuses(proposalId)).toEqual(['pending']);
    });

    it('lets staff resolve the submissions of a suspended author', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);
      await setAccountStatus(app.app.get(DataSource), diego.username, 'suspended');

      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
    });

    it('hides the microchanges of drafts', async () => {
      const { changeId } = await draftIdentityCreation(app, diego.accessToken);

      for (const id of [changeId, randomUUID(), 'not-a-uuid']) {
        const response = await decideChange(app, moderator.accessToken, id, { action: 'apply' }).expect(404);
        expect(response.body.errors[0].code).toBe('proposal_change_not_found');
      }
    });

    it('validates the payload again before applying it', async () => {
      const { proposalId, changeId } = await draftIdentityCreation(app, diego.accessToken);
      const dataSource = app.app.get(DataSource);
      const [{ id: countryId }] = await dataSource.query(`INSERT INTO countries (code, name) VALUES ('KR', 'Corea del Sur') RETURNING id`);
      const proposedValue = organizationCreation({ originCountryId: countryId });
      await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue }).expect(200);
      await submitProposal(app, diego.accessToken, proposalId).expect(200);
      await dataSource.query('DELETE FROM countries');

      const response = await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'unknown_vocabulary_entry', meta: expect.objectContaining({ changeId }) }),
      ]);
      expect(await statuses(proposalId)).toEqual(['pending']);
    });

    it('leaves no decision, revision or entry behind when the application fails', async () => {
      const { entityId, proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      const dataSource = app.app.get(DataSource);
      // The revision is the last write of an application; failing there must undo every earlier one.
      await dataSource.query(
        `CREATE FUNCTION fail_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revision refused'; END $$`,
      );
      await dataSource.query(
        'CREATE TRIGGER fail_revision BEFORE INSERT ON entity_revisions FOR EACH ROW EXECUTE FUNCTION fail_revision()',
      );
      try {
        await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(500);
      } finally {
        await dataSource.query('DROP TRIGGER fail_revision ON entity_revisions');
        await dataSource.query('DROP FUNCTION fail_revision()');
      }

      const history = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, moderator.accessToken).expect(200);
      expect(history.body.data).toEqual([]);
      expect(await statuses(proposalId)).toEqual(['pending']);
      expect(await rootState(entityId)).toEqual(expect.objectContaining({ publicationStatus: 'reserved', currentVersion: 0 }));
      const proposal = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(proposal.body.data.attributes.status).toBe('open');

      // A retry rereads everything and succeeds.
      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
    });
  });

  describe('GET /v1/proposal-changes/{id}/decisions', () => {
    it('shows the decisions to the author and to staff', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);
      await decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason: 'Sin fuentes fiables' }).expect(201);

      for (const account of [diego, moderator, admin]) {
        const response = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions?include=actor`, account.accessToken).expect(200);
        expect(response.body.data).toEqual([
          expect.objectContaining({
            type: 'change-decisions',
            attributes: expect.objectContaining({ action: 'reject', reason: 'Sin fuentes fiables' }),
          }),
        ]);
        expect(response.body.included).toEqual([expect.objectContaining({ type: 'users', id: moderator.uuid })]);
        expect(response.body.meta).toEqual({ total: 1 });
      }
    });

    it('hides them from the public and from other accounts', async () => {
      const { changeId } = await submitIdentityCreation(app, diego.accessToken);
      const ana = await registerVerified(app, 'ana');

      await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`).expect(401);
      const response = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, ana.accessToken).expect(403);
      expect(response.body.errors[0].code).toBe('not_change_reviewer');
    });

    it('does not exist for a microchange of a draft, even for staff', async () => {
      const { changeId } = await draftIdentityCreation(app, diego.accessToken);

      await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, moderator.accessToken).expect(404);
    });

    it('keeps the outcome out of the public projection of the proposal', async () => {
      const { proposalId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      await decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason: 'Sin fuentes fiables' }).expect(201);

      const response = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes`).expect(200);

      expect(response.body.included[0].attributes).not.toHaveProperty('status');
      expect(JSON.stringify(response.body)).not.toContain('Sin fuentes fiables');
    });
  });

  describe('GET /v1/identities/{id}', () => {
    it('does not exist for an unknown public id', async () => {
      const response = await getJsonApi(app, '/v1/identities/desconocida').expect(404);

      expect(response.body.errors[0].code).toBe('identity_not_found');
    });
  });
});
