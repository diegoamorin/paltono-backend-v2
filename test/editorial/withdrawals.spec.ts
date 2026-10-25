import { DataSource } from 'typeorm';
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

const MINUTE = 60_000;

describe('withdrawing a published entry (withdraw_entity)', () => {
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

  const withdrawal = (entityId: string): ChangeInput => ({
    entityId,
    operation: 'withdraw_entity',
    targetPath: 'publication_status',
    proposedValue: { exists: true, value: 'withdrawn' },
  });

  const addAlias = (entityId: string, alias: string): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath: 'catalog_identity_aliases',
    proposedValue: { exists: true, value: { alias, isPrimary: false, sortOrder: 0 } },
  });

  const setHeight = (entityId: string, heightCm: number): ChangeInput => ({
    entityId,
    operation: 'set_fields',
    targetPath: 'people.height_cm',
    proposedValue: { exists: true, value: heightCm },
  });

  /** Submits a proposal of the given account with the given microchanges and a source. */
  async function submitChanges(account: Account, changes: ChangeInput[]) {
    const proposalId = await createDraft(app, account.accessToken, 'Retirada de IU');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, account.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, account.accessToken, proposalId).expect(200);
    return { proposalId, changeIds };
  }

  async function statuses(author: Account, proposalId: string): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, author.accessToken).expect(200);
    return body.data.map((change: { attributes: { status: string } }) => change.attributes.status);
  }

  it('lets any account request it and an administrator apply it, keeping the root, its ids and its history', async () => {
    const { entityId, publicId } = await publishPerson();
    const { proposalId, changeIds } = await submitChanges(luis, [withdrawal(entityId)]);
    app.clock.advance(MINUTE);

    const response = await decideChange(app, admin.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

    expect(response.body.data[0].attributes).toEqual(
      expect.objectContaining({ action: 'apply', resultingStatus: 'applied', observedValue: { exists: true, value: 'published' } }),
    );
    expect(response.body.included[0].attributes).toEqual(
      expect.objectContaining({ version: 2, beforeValue: { exists: true, value: 'published' }, afterValue: { exists: true, value: 'withdrawn' } }),
    );
    const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
    expect(root.body.data.attributes).toEqual(
      expect.objectContaining({
        publicationStatus: 'withdrawn',
        currentVersion: 2,
        publishedAt: '2026-01-01T00:00:00.000Z',
        withdrawnAt: '2026-01-01T00:01:00.000Z',
      }),
    );
    expect(await statuses(luis, proposalId)).toEqual(['applied']);
    // A visitor still reads every submission of its history and its sources, without the outcome of each microchange.
    const history = await getJsonApi(app, `/v1/editorial-entities/${entityId}/proposals?include=changes,sources`).expect(200);
    expect(history.body.data.map(({ id }: { id: string }) => id)).toEqual(expect.arrayContaining([proposalId]));
    expect(history.body.meta.total).toBe(2);
    for (const resource of history.body.included.filter(({ type }: { type: string }) => type === 'proposal-changes')) {
      expect(resource.attributes).not.toHaveProperty('status');
    }
    expect(history.body.included.filter(({ type }: { type: string }) => type === 'proposal-sources')).toHaveLength(2);

    // The entry answers 200 with the notice and none of the withdrawn content.
    const entry = await getJsonApi(app, `/v1/identities/${publicId}`).expect(200);
    expect(entry.body.data).toEqual({
      type: 'identities',
      id: publicId,
      attributes: { publicationStatus: 'withdrawn', withdrawnAt: '2026-01-01T00:01:00.000Z' },
      meta: { editorialEntityId: entityId },
    });
  });

  it('refuses to let a moderator apply it, without writing, but lets one reject it', async () => {
    const { entityId } = await publishPerson();
    const { proposalId, changeIds } = await submitChanges(luis, [withdrawal(entityId)]);

    for (const attributes of [{ action: 'apply' }, { action: 'apply_rebased', confirmedVersion: 1, reason: 'Retirada' }]) {
      const response = await decideChange(app, moderator.accessToken, changeIds[0], attributes).expect(403);
      expect(response.body.errors[0].code).toBe('administrator_required');
    }
    const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
    expect(root.body.data.attributes).toEqual(expect.objectContaining({ publicationStatus: 'published', currentVersion: 1 }));

    await decideChange(app, moderator.accessToken, changeIds[0], { action: 'reject', reason: 'Sin motivo para retirarla' }).expect(201);
    expect(await statuses(luis, proposalId)).toEqual(['rejected']);
  });

  it('keeps the relations it had, puts pending proposals on it in conflict and accepts no new relations', async () => {
    const { entityId } = await publishPerson();
    const alias = await submitChanges(ana, [addAlias(entityId, 'Lee Ji-eun')]);
    await decideChange(app, moderator.accessToken, alias.changeIds[0], { action: 'apply' }).expect(201);
    const pending = await submitChanges(ana, [setHeight(entityId, 170), addAlias(entityId, 'Dami')]);
    const otherRequest = await submitChanges(ana, [withdrawal(entityId)]);
    const { changeIds } = await submitChanges(luis, [withdrawal(entityId)]);
    const draftId = await createDraft(app, luis.accessToken);
    await addChange(app, luis.accessToken, draftId, addAlias(entityId, 'Jieun')).expect(201);

    await decideChange(app, admin.accessToken, changeIds[0], { action: 'apply' }).expect(201);

    // The pending edits wait in conflict, with an automatic decision; the duplicate request already holds its result.
    expect(await statuses(ana, pending.proposalId)).toEqual(['conflicted', 'conflicted']);
    const decisions = await getJsonApi(app, `/v1/proposal-changes/${pending.changeIds[0]}/decisions`, ana.accessToken).expect(200);
    expect(decisions.body.data[0].attributes).toEqual(
      expect.objectContaining({ action: 'mark_conflict', resultingStatus: 'conflicted', reason: expect.stringContaining('retiró') }),
    );
    expect(decisions.body.data[0].relationships.actor.data).toBeNull();
    expect(await statuses(ana, otherRequest.proposalId)).toEqual(['satisfied']);

    // They cannot be applied while the root is withdrawn, not even over a confirmed base, but can be rejected.
    for (const attributes of [{ action: 'apply' }, { action: 'apply_rebased', confirmedVersion: 3, reason: 'Fuente nueva' }]) {
      const refused = await decideChange(app, moderator.accessToken, pending.changeIds[0], attributes).expect(409);
      expect(refused.body.errors[0].code).toBe('entity_withdrawn');
    }
    await decideChange(app, moderator.accessToken, pending.changeIds[1], { action: 'reject', reason: 'La ficha está retirada' }).expect(201);
    expect(await statuses(ana, pending.proposalId)).toEqual(['conflicted', 'rejected']);

    // No new relation reaches it: neither a draft written before nor a new one.
    await addSource(app, luis.accessToken, draftId, { url: WIKIPEDIA }).expect(201);
    const refusedSubmission = await submitProposal(app, luis.accessToken, draftId).expect(422);
    expect(refusedSubmission.body.errors[0].code).toBe('entity_not_published');
    const newDraft = await createDraft(app, luis.accessToken);
    await addChange(app, luis.accessToken, newDraft, addAlias(entityId, 'Jieun')).expect(422);
    // Not even a relation whose key names the root itself.
    const [{ id: countryId }] = await app.app.get(DataSource).query(`INSERT INTO countries (code, name) VALUES ('KR', 'South Korea') RETURNING id`);
    const nationality = {
      entityId,
      operation: 'add_relation',
      targetPath: 'person_nationalities',
      targetKey: { person_id: { entity_id: entityId }, country_id: countryId },
      proposedValue: { exists: true, value: {} },
    };
    const refusedNationality = await addChange(app, luis.accessToken, newDraft, nationality).expect(422);
    expect(refusedNationality.body.errors[0].code).toBe('entity_not_published');

    // Its rows and ids stay: nothing cascades.
    const [{ count }] = await app.app
      .get(DataSource)
      .query(
        `SELECT count(*)::int AS count FROM catalog_identity_aliases a JOIN catalog_identities i ON i.id = a.catalog_identity_id WHERE i.editorial_entity_id = $1`,
        [entityId],
      );
    expect(count).toBe(1);
  });

  it('blocks a microchange whose applied prerequisite created a root that was withdrawn since', async () => {
    const { entityId: other } = await publishPerson();
    // One proposal creates a root and, depending on it, changes another one.
    const { entityId, proposalId, changeId } = await draftIdentityCreation(app, luis.accessToken);
    const { body } = await addChange(app, luis.accessToken, proposalId, setHeight(other, 170)).expect(201);
    await changeDependencies(app, luis.accessToken, 'post', body.data.id, [changeId]).expect(200);
    await submitProposal(app, luis.accessToken, proposalId).expect(200);
    await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
    const request = await submitChanges(ana, [withdrawal(entityId)]);
    await decideChange(app, admin.accessToken, request.changeIds[0], { action: 'apply' }).expect(201);

    const response = await decideChange(app, moderator.accessToken, body.data.id, { action: 'apply' }).expect(409);

    expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'dependency_failed', meta: { changeId: body.data.id, dependsOn: [changeId] } }));
    expect(await statuses(luis, proposalId)).toEqual(['applied', 'blocked']);
  });

  it('only targets a published root', async () => {
    const { entityId } = await submitIdentityCreation(app, ana.accessToken);
    const proposalId = await createDraft(app, ana.accessToken);

    const response = await addChange(app, ana.accessToken, proposalId, withdrawal(entityId)).expect(422);

    expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'entity_not_published' }));
  });

  it('does not share a proposal with other microchanges on the same root', async () => {
    const { entityId } = await publishPerson();
    const proposalId = await createDraft(app, luis.accessToken);
    await addChange(app, luis.accessToken, proposalId, setHeight(entityId, 170)).expect(201);

    const response = await addChange(app, luis.accessToken, proposalId, withdrawal(entityId)).expect(422);

    expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'overlapping_change' }));
  });
});
