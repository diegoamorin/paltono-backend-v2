import { DataSource } from 'typeorm';
import { sendJsonApi, setAccountStatus } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  changeDependencies,
  createDraft,
  decideChange,
  draftIdentityCreation,
  getJsonApi,
  submitIdentityCreation,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

describe('POST /v1/proposals/{id}/publication (E18)', () => {
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

  function publish(accessToken: string, proposalId: string, query = '') {
    return sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication${query}`, { data: { type: 'publications' } }).set(
      'Authorization',
      `Bearer ${accessToken}`,
    );
  }

  const setHeight = (entityId: string, heightCm: number): ChangeInput => ({
    entityId,
    operation: 'set_fields',
    targetPath: 'people.height_cm',
    proposedValue: { exists: true, value: heightCm },
  });

  const withdrawal = (entityId: string): ChangeInput => ({
    entityId,
    operation: 'withdraw_entity',
    targetPath: 'publication_status',
    proposedValue: { exists: true, value: 'withdrawn' },
  });

  /** A draft of the given account with the given microchanges and a source. */
  async function draftChanges(account: Account, changes: ChangeInput[]) {
    const proposalId = await createDraft(app, account.accessToken, 'Datos de IU');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, account.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    return { proposalId, changeIds };
  }

  async function publishedPerson(): Promise<string> {
    const { entityId, changeId } = await submitIdentityCreation(app, ana.accessToken);
    await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
    return entityId;
  }

  async function rootState(entityId: string, accessToken?: string) {
    return (await getJsonApi(app, `/v1/editorial-entities/${entityId}`, accessToken).expect(200)).body.data.attributes;
  }

  it('submits and applies a draft of staff in one go, with its source, decision and revision; author and approver coincide', async () => {
    const { entityId, proposalId, changeId, sourceId } = await draftIdentityCreation(app, moderator.accessToken);

    const response = await publish(moderator.accessToken, proposalId, '?include=changes,sources').expect(200);

    expect(response.body.data).toEqual(
      expect.objectContaining({ type: 'proposals', id: proposalId, attributes: expect.objectContaining({ status: 'closed' }) }),
    );
    expect(response.body.data.attributes.submittedAt).toEqual(response.body.data.attributes.closedAt);
    expect(response.body.meta).toEqual({ informationKind: 'proposed' });
    expect(response.body.included).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'proposal-changes', id: changeId, attributes: expect.objectContaining({ status: 'applied' }) }),
        expect.objectContaining({ type: 'proposal-sources', id: sourceId }),
      ]),
    );
    expect(await rootState(entityId)).toEqual(expect.objectContaining({ publicationStatus: 'published', currentVersion: 1 }));
    const decisions = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions?include=actor,revision`, moderator.accessToken).expect(200);
    expect(decisions.body.data).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({ action: 'apply', previousStatus: 'pending', resultingStatus: 'applied' }),
        relationships: expect.objectContaining({ actor: { data: { type: 'users', id: moderator.uuid } } }),
      }),
    ]);
    expect(decisions.body.included).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'entity-revisions', attributes: expect.objectContaining({ version: 1 }) })]),
    );
    // The submission is public like any other.
    const history = await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals`).expect(200);
    expect(history.body.data.map(({ id }: { id: string }) => id)).toEqual([proposalId]);
  });

  it('applies every microchange in dependency order', async () => {
    const entityId = await publishedPerson();
    const alias = { entityId, operation: 'add_relation', targetPath: 'catalog_identity_aliases', proposedValue: { exists: true, value: { alias: 'Dami', isPrimary: false, sortOrder: 0 } } };
    const { proposalId, changeIds } = await draftChanges(moderator, [setHeight(entityId, 170), alias]);
    await changeDependencies(app, moderator.accessToken, 'post', changeIds[0], [changeIds[1]]).expect(200);

    const response = await publish(moderator.accessToken, proposalId, '?include=changes').expect(200);

    expect(response.body.included.map(({ attributes }: { attributes: { status: string } }) => attributes.status)).toEqual(['applied', 'applied']);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, moderator.accessToken).expect(200);
    expect(revisions.body.data.map(({ attributes }: { attributes: { version: number; afterValue: object } }) => [attributes.version, attributes.afterValue])).toEqual([
      [1, expect.anything()],
      [2, { exists: true, value: { alias: 'Dami', isPrimary: false, sortOrder: 0 } }],
      [3, { exists: true, value: 170 }],
    ]);
  });

  it('rolls everything back when a microchange cannot apply, leaving the draft as it was', async () => {
    const entityId = await publishedPerson();
    const { proposalId, changeIds } = await draftChanges(moderator, [setHeight(entityId, 170)]);
    // Someone else's height is applied after the draft read its base.
    const other = await draftChanges(ana, [setHeight(entityId, 175)]);
    await submitProposal(app, ana.accessToken, other.proposalId).expect(200);
    await decideChange(app, admin.accessToken, other.changeIds[0], { action: 'apply' }).expect(201);

    const response = await publish(moderator.accessToken, proposalId).expect(409);

    expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'base_changed', meta: expect.objectContaining({ changeId: changeIds[0] }) }));
    const draft = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes`, moderator.accessToken).expect(200);
    expect(draft.body.data.attributes).toEqual(expect.objectContaining({ status: 'draft', submittedAt: null }));
    expect(draft.body.included[0].attributes.status).toBe('pending');
    expect(await rootState(entityId)).toEqual(expect.objectContaining({ currentVersion: 2 }));
    // Nothing was decided: the microchange of a draft has no decisions.
    await getJsonApi(app, `/v1/proposal-changes/${changeIds[0]}/decisions`, moderator.accessToken).expect(404);
  });

  it('validates the draft as a submission', async () => {
    const entityId = await publishedPerson();
    const proposalId = await createDraft(app, moderator.accessToken, 'Altura');
    await addChange(app, moderator.accessToken, proposalId, setHeight(entityId, 170)).expect(201);

    const response = await publish(moderator.accessToken, proposalId).expect(422);

    expect(response.body.errors.map(({ code }: { code: string }) => code)).toEqual(['sources_required']);
    expect(await rootState(entityId)).toEqual(expect.objectContaining({ currentVersion: 1 }));
  });

  it('is only for staff publishing their own draft', async () => {
    const own = await draftIdentityCreation(app, ana.accessToken);
    const response = await publish(ana.accessToken, own.proposalId).expect(403);
    expect(response.body.errors[0].code).toBe('staff_required');

    // Another author's draft does not exist for staff.
    await publish(moderator.accessToken, own.proposalId).expect(404);
    const submitted = await submitIdentityCreation(app, moderator.accessToken);
    const frozen = await publish(moderator.accessToken, submitted.proposalId).expect(409);
    expect(frozen.body.errors[0].code).toBe('proposal_submitted');
    expect(await rootState(own.entityId, ana.accessToken)).toEqual(expect.objectContaining({ publicationStatus: 'reserved' }));
  });

  it('requires an administrator to withdraw a published entry', async () => {
    const entityId = await publishedPerson();
    const byModerator = await draftChanges(moderator, [withdrawal(entityId)]);
    const refused = await publish(moderator.accessToken, byModerator.proposalId).expect(403);
    expect(refused.body.errors[0].code).toBe('administrator_required');
    expect(await rootState(entityId)).toEqual(expect.objectContaining({ publicationStatus: 'published' }));

    const byAdmin = await draftChanges(admin, [withdrawal(entityId)]);
    await publish(admin.accessToken, byAdmin.proposalId).expect(200);
    expect(await rootState(entityId)).toEqual(expect.objectContaining({ publicationStatus: 'withdrawn' }));
  });

  it('refuses a suspended or demoted moderator', async () => {
    const { proposalId } = await draftIdentityCreation(app, moderator.accessToken);
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'user', reason: 'Fin de la moderación' }).expect(201);
    await publish(moderator.accessToken, proposalId).expect(403);

    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Vuelve' }).expect(201);
    await setAccountStatus(app.app.get(DataSource), moderator.username, 'suspended');
    await publish(moderator.accessToken, proposalId).expect(401);
  });
});
