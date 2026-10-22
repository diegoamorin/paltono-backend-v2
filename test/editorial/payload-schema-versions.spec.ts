import { IDENTITY_CREATION } from '../../src/editorial/identity-creation';
import { OPERATIONS, useOperations } from '../../src/editorial/operation-registry';
import { IDENTITY_FIELD_CHANGES } from '../../src/editorial/identity-field-changes';
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
  personCreation,
  removeChange,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
  updateChange,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

/** Publishes a version 2 of the identity creation, as a deployment that changes its payload without an upcast would. */
function publishCreationV2(): () => void {
  return useOperations([...OPERATIONS, { ...IDENTITY_CREATION, payloadSchemaVersion: 2 }]);
}

const DISPLAY_NAME = 'catalog_identities.display_name';
const ALIASES = 'catalog_identity_aliases';

/** Publishes a version 2 of the change of an identity's display name, without an upcast. */
function publishDisplayNameV2(): () => void {
  const v1 = IDENTITY_FIELD_CHANGES.find(({ targetPath }) => targetPath === DISPLAY_NAME)!;
  return useOperations([...OPERATIONS, { ...v1, payloadSchemaVersion: 2 }]);
}

describe('payload schema versions', () => {
  let app: TestApp;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Every page of E1. */
  async function listOperations(): Promise<{ id: string; attributes: { status: string } }[]> {
    const operations = [];
    for (let page = 1; ; page++) {
      const { body } = await getJsonApi(app, `/v1/editorial-operations?page[size]=100&page[number]=${page}`).expect(200);
      operations.push(...body.data);
      if (operations.length >= body.meta.total) return operations;
    }
  }

  describe('GET /v1/editorial-operations', () => {
    it('marks the highest version of a selector current and keeps listing the older one as obsolete', async () => {
      restore = publishCreationV2();

      const operations = await listOperations();

      const statusOf = (id: string) => operations.find((operation) => operation.id === id)?.attributes.status;
      expect(statusOf('identity.create_entity.catalog_identities.v1')).toBe('obsolete');
      expect(statusOf('identity.create_entity.catalog_identities.v2')).toBe('current');
      expect(statusOf('identity.set_fields.catalog_identities.display_name.v1')).toBe('current');
    });
  });

  describe('POST and PATCH /v1/proposals/{id}/changes', () => {
    let diego: Account;

    beforeEach(async () => {
      await app.reset();
      diego = await registerVerified(app, 'diego_papi');
    });

    it('stores the current version when the client omits it', async () => {
      restore = publishCreationV2();
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: undefined }).expect(201);

      expect(response.body.data.attributes.payloadSchemaVersion).toBe(2);
    });

    it('rejects an obsolete version, also when editing a microchange of the draft', async () => {
      const { proposalId, changeId, entityId } = await draftIdentityCreation(app, diego.accessToken);
      restore = publishCreationV2();

      const added = await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: 1 }).expect(422);
      const edited = await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue: personCreation({ displayName: '아이유' }) }).expect(422);

      for (const { body } of [added, edited]) {
        expect(body.errors).toEqual([
          expect.objectContaining({ code: 'obsolete_payload_schema_version', source: { pointer: '/data/attributes/payloadSchemaVersion' } }),
        ]);
      }
      await updateChange(app, diego.accessToken, proposalId, changeId, { payloadSchemaVersion: 2, proposedValue: personCreation() }).expect(200);
    });
  });

  describe('a draft left on an obsolete version', () => {
    let diego: Account;

    beforeEach(async () => {
      await app.reset();
      diego = await registerVerified(app, 'diego_papi');
    });

    it('shows its author the obsolete microchange as written, and cannot be submitted until it is redone', async () => {
      const { proposalId, changeId, entityId } = await draftIdentityCreation(app, diego.accessToken);
      restore = publishCreationV2();

      const shown = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes`, diego.accessToken).expect(200);
      const own = await getJsonApi(app, '/v1/me/proposals?include=changes', diego.accessToken).expect(200);
      for (const { body } of [shown, own]) {
        expect(body.included).toEqual([
          expect.objectContaining({
            id: changeId,
            attributes: expect.objectContaining({ payloadSchemaVersion: 1, payloadSchemaStatus: 'obsolete', proposedValue: personCreation() }),
          }),
        ]);
      }

      const refused = await submitProposal(app, diego.accessToken, proposalId).expect(422);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ code: 'obsolete_payload_schema_version', meta: { changeId, member: 'payloadSchemaVersion' } }),
      ]);

      await removeChange(app, diego.accessToken, proposalId, changeId).expect(204);
      await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: 2 }).expect(201);
      await submitProposal(app, diego.accessToken, proposalId).expect(200);
    });
  });

  describe('a submission left on an obsolete version', () => {
    let admin: Account;
    let moderator: Account;
    let ana: Account;
    let luis: Account;
    let entityId: string;

    beforeEach(async () => {
      await app.reset();
      admin = await registerFirstAdmin(app);
      moderator = await registerVerified(app, 'moderadora');
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      ana = await registerVerified(app, 'ana');
      luis = await registerVerified(app, 'luis');
      const creation = await submitIdentityCreation(app, ana.accessToken);
      await decideChange(app, moderator.accessToken, creation.changeId, { action: 'apply' }).expect(201);
      entityId = creation.entityId;
    });

    const displayName = (value: string, payloadSchemaVersion = 1): ChangeInput => ({
      entityId,
      operation: 'set_fields',
      targetPath: DISPLAY_NAME,
      payloadSchemaVersion,
      proposedValue: { exists: true, value },
    });

    const addAlias = (value: string, sortOrder: number): ChangeInput => ({
      entityId,
      operation: 'add_relation',
      targetPath: ALIASES,
      proposedValue: { exists: true, value: { alias: value, isPrimary: false, sortOrder } },
    });

    /** Submits the given microchanges as one proposal of the account; `dependencies` are [dependent, prerequisite] indexes. */
    async function submitChanges(account: Account, changes: ChangeInput[], dependencies: [number, number][] = []) {
      const proposalId = await createDraft(app, account.accessToken, 'Datos de IU');
      const changeIds: string[] = [];
      for (const change of changes) changeIds.push((await addChange(app, account.accessToken, proposalId, change).expect(201)).body.data.id);
      for (const [dependent, prerequisite] of dependencies) {
        await changeDependencies(app, account.accessToken, 'post', changeIds[dependent], [changeIds[prerequisite]]).expect(200);
      }
      await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, account.accessToken, proposalId).expect(200);
      return { proposalId, changeIds };
    }

    async function decisionsOf(changeId: string) {
      const { body } = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, moderator.accessToken).expect(200);
      return body.data.map(({ attributes, relationships }: { attributes: object; relationships: { actor: { data: unknown } } }) => ({
        ...attributes,
        actor: relationships.actor.data,
      }));
    }

    it('closes it with an automatic mark_obsolete instead of applying it, and blocks its atomic group and its dependents', async () => {
      const group = '0b9e6f0e-4d47-4d0f-9a43-6c3c2f5a1d10';
      const { proposalId, changeIds } = await submitChanges(
        luis,
        [{ ...displayName('아이유'), atomicGroupId: group }, { ...addAlias('Lee Ji-eun', 0), atomicGroupId: group }, addAlias('Dami', 1)],
        [[2, 0]],
      );
      restore = publishDisplayNameV2();

      const refused = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }).expect(409);

      expect(refused.body.errors).toEqual([expect.objectContaining({ code: 'obsolete_payload_schema_version', meta: { changeId: changeIds[0] } })]);
      expect(await decisionsOf(changeIds[0])).toEqual([
        expect.objectContaining({
          action: 'mark_obsolete',
          previousStatus: 'pending',
          resultingStatus: 'blocked',
          reason: expect.stringContaining('obsoleta'),
          observedVersion: 1,
          observedValue: null,
        }),
      ]);
      for (const blocked of changeIds.slice(1)) {
        expect(await decisionsOf(blocked)).toEqual([expect.objectContaining({ action: 'block_dependency', resultingStatus: 'blocked' })]);
      }
      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}`, moderator.accessToken).expect(200);
      expect(body.data.attributes.status).toBe('closed');
      const { body: identity } = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(identity.data.attributes.currentVersion).toBe(1);
    });

    it('records mark_obsolete whatever the decision asked, even a rejection that lacks its reason', async () => {
      const { changeIds } = await submitChanges(luis, [displayName('아이유')]);
      restore = publishDisplayNameV2();

      await decideChange(app, moderator.accessToken, changeIds[0], { action: 'reject' }).expect(409);

      expect(await decisionsOf(changeIds[0])).toEqual([expect.objectContaining({ action: 'mark_obsolete', actor: null, resultingStatus: 'blocked' })]);
    });

    it('closes an obsolete competitor with mark_obsolete when a field change applies, never comparing values of different versions', async () => {
      const { proposalId, changeIds: obsolete } = await submitChanges(ana, [displayName('아이유')]);
      restore = publishDisplayNameV2();
      const { changeIds: current } = await submitChanges(luis, [displayName('아이유', 2)]);

      await decideChange(app, moderator.accessToken, current[0], { action: 'apply' }).expect(201);

      expect(await decisionsOf(obsolete[0])).toEqual([expect.objectContaining({ action: 'mark_obsolete', resultingStatus: 'blocked', observedValue: null })]);
      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}`, moderator.accessToken).expect(200);
      expect(body.data.attributes.status).toBe('closed');
    });

    it('closes an obsolete microchange with mark_obsolete when its root is withdrawn', async () => {
      const { changeIds: obsolete } = await submitChanges(luis, [displayName('아이유')]);
      restore = publishDisplayNameV2();
      const withdrawal: ChangeInput = { entityId, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } };
      const { changeIds } = await submitChanges(ana, [withdrawal]);

      await decideChange(app, admin.accessToken, changeIds[0], { action: 'apply' }).expect(201);

      expect(await decisionsOf(obsolete[0])).toEqual([expect.objectContaining({ action: 'mark_obsolete', resultingStatus: 'blocked' })]);
    });
  });
});
