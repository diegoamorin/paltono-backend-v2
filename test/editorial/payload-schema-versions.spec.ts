import { DataSource } from 'typeorm';
import { IDENTITY_CREATION } from '../../src/editorial/identity-creation';
import { OPERATIONS, useOperations } from '../../src/editorial/operation-registry';
import { IDENTITY_FIELD_CHANGES } from '../../src/editorial/identity-field-changes';
import { ROW_KEY } from '../../src/editorial/identity-relation-changes';
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

/** Publishes a version 3 of the identity creation, as a deployment that changes its payload without an upcast would. */
function publishCreationV3(): () => void {
  return useOperations([...OPERATIONS, { ...IDENTITY_CREATION, payloadSchemaVersion: 3 }]);
}

const DISPLAY_NAME = 'catalog_identities.display_name';
const ALIASES = 'catalog_identity_aliases';

/** Publishes a version 2 of the change of an identity's display name, without an upcast. */
function publishDisplayNameV2(): () => void {
  const v1 = IDENTITY_FIELD_CHANGES.find(({ targetPath }) => targetPath === DISPLAY_NAME)!;
  return useOperations([...OPERATIONS, { ...v1, payloadSchemaVersion: 2 }]);
}

const RETIRED_PATH = 'catalog_identity_fan_sites';

/**
 * Publishes a selector retired without a successor: its version keeps its
 * description and schemas to read the history, with no code to apply it.
 */
function publishRetiredSelector(): () => void {
  return useOperations([
    ...OPERATIONS,
    {
      entityType: 'identity',
      operation: 'add_relation',
      targetPath: RETIRED_PATH,
      payloadSchemaVersion: 1,
      description: 'Retirada: añadía un sitio de fans a una identidad.',
      valueSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
      targetKeySchema: ROW_KEY,
    },
  ]);
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
      restore = publishCreationV3();

      const operations = await listOperations();

      const statusOf = (id: string) => operations.find((operation) => operation.id === id)?.attributes.status;
      expect(statusOf('identity.create_entity.catalog_identities.v2')).toBe('obsolete');
      expect(statusOf('identity.create_entity.catalog_identities.v3')).toBe('current');
      expect(statusOf('identity.set_fields.catalog_identities.display_name.v1')).toBe('current');
    });

    it('lists every version of a retired selector as obsolete', async () => {
      restore = publishRetiredSelector();

      const operations = await listOperations();

      const statusOf = (id: string) => operations.find((operation) => operation.id === id)?.attributes.status;
      expect(statusOf(`identity.add_relation.${RETIRED_PATH}.v1`)).toBe('obsolete');
    });
  });

  describe('POST and PATCH /v1/proposals/{id}/changes', () => {
    let diego: Account;

    beforeEach(async () => {
      await app.reset();
      diego = await registerVerified(app, 'diego_papi');
    });

    it('stores the current version when the client omits it', async () => {
      restore = publishCreationV3();
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: undefined }).expect(201);

      expect(response.body.data.attributes.payloadSchemaVersion).toBe(3);
    });

    it('rejects an obsolete version, also when editing a microchange of the draft', async () => {
      const { proposalId, changeId, entityId } = await draftIdentityCreation(app, diego.accessToken);
      restore = publishCreationV3();

      const added = await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: 2 }).expect(422);
      const edited = await updateChange(app, diego.accessToken, proposalId, changeId, { proposedValue: personCreation({ displayName: '아이유' }) }).expect(422);

      for (const { body } of [added, edited]) {
        expect(body.errors).toEqual([
          expect.objectContaining({ code: 'obsolete_payload_schema_version', source: { pointer: '/data/attributes/payloadSchemaVersion' } }),
        ]);
      }
      await updateChange(app, diego.accessToken, proposalId, changeId, { payloadSchemaVersion: 3, proposedValue: personCreation() }).expect(200);
    });

    it('rejects a microchange of a retired selector, with or without a version', async () => {
      restore = publishRetiredSelector();
      const entityId = await reserveIdentity(app, diego.accessToken);
      const proposalId = await createDraft(app, diego.accessToken);
      const link = {
        entityId,
        operation: 'add_relation',
        targetPath: RETIRED_PATH,
        targetKey: { id: 1 },
        proposedValue: { exists: true, value: { url: 'https://example.com/fans' } },
      };

      for (const payloadSchemaVersion of [1, undefined]) {
        const { body } = await addChange(app, diego.accessToken, proposalId, { ...link, payloadSchemaVersion }).expect(422);
        expect(body.errors).toEqual([
          expect.objectContaining({ code: 'obsolete_payload_schema_version', source: { pointer: '/data/attributes/payloadSchemaVersion' } }),
        ]);
      }
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
      restore = publishCreationV3();

      const shown = await getJsonApi(app, `/v1/proposals/${proposalId}?include=changes`, diego.accessToken).expect(200);
      const own = await getJsonApi(app, '/v1/me/proposals?include=changes', diego.accessToken).expect(200);
      for (const { body } of [shown, own]) {
        expect(body.included).toEqual([
          expect.objectContaining({
            id: changeId,
            attributes: expect.objectContaining({ payloadSchemaVersion: 2, payloadSchemaStatus: 'obsolete', proposedValue: personCreation() }),
          }),
        ]);
      }

      const refused = await submitProposal(app, diego.accessToken, proposalId).expect(422);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ code: 'obsolete_payload_schema_version', meta: { changeId, member: 'payloadSchemaVersion' } }),
      ]);

      await removeChange(app, diego.accessToken, proposalId, changeId).expect(204);
      await addChange(app, diego.accessToken, proposalId, { entityId, payloadSchemaVersion: 3 }).expect(201);
      await submitProposal(app, diego.accessToken, proposalId).expect(200);
    });
  });

  describe('the complete dates of a person, replaced by partial ones without a translation', () => {
    const SELECTORS = [
      ['identity.create_entity.catalog_identities', { operation: 'create_entity', targetPath: 'catalog_identities', proposedValue: personCreation({ person: { birthDate: '1993-05-16' } }) }],
      ['identity.set_fields.people.birth_date', { operation: 'set_fields', targetPath: 'people.birth_date', proposedValue: { exists: true, value: '1993-05-16' } }],
      ['identity.set_fields.people.death_date', { operation: 'set_fields', targetPath: 'people.death_date', proposedValue: { exists: true, value: '2020-01-02' } }],
    ] as const;
    let diego: Account;
    let moderator: Account;

    beforeEach(async () => {
      await app.reset();
      const admin = await registerFirstAdmin(app);
      diego = await registerVerified(app, 'diego_papi');
      moderator = await registerVerified(app, 'modera_ana');
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    });

    /** IU's root once published. */
    async function publishPerson(): Promise<string> {
      const { entityId, changeId } = await submitIdentityCreation(app, diego.accessToken);
      await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
      return entityId;
    }

    it.each(SELECTORS)('keeps listing %s v1 as obsolete, with v2 current', async (id) => {
      const operations = await listOperations();

      const statusOf = (version: number) => operations.find((operation) => operation.id === `${id}.v${version}`)?.attributes.status;
      expect([statusOf(1), statusOf(2)]).toEqual(['obsolete', 'current']);
    });

    it.each(SELECTORS)('refuses a microchange of %s in v1', async (_, change) => {
      const entityId = change.operation === 'create_entity' ? await reserveIdentity(app, diego.accessToken) : await publishPerson();
      const proposalId = await createDraft(app, diego.accessToken);

      const response = await addChange(app, diego.accessToken, proposalId, { entityId, ...change, payloadSchemaVersion: 1 }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'obsolete_payload_schema_version', source: { pointer: '/data/attributes/payloadSchemaVersion' } }),
      ]);
    });

    it('refuses to submit a draft left with a microchange in v1', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, diego.accessToken);
      const added = await addChange(app, diego.accessToken, proposalId, {
        entityId,
        operation: 'set_fields',
        targetPath: 'people.birth_date',
        proposedValue: { exists: true, value: { year: 1993 } },
      }).expect(201);
      const changeId = added.body.data.id;
      await addSource(app, diego.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      // What a draft written before version 2 holds.
      await app.app.get(DataSource).query(`UPDATE proposal_changes SET payload_schema_version = 1, proposed_value = '{"exists": true, "value": "1993-05-16"}' WHERE id = $1`, [changeId]);

      const refused = await submitProposal(app, diego.accessToken, proposalId).expect(422);

      expect(refused.body.errors).toEqual([expect.objectContaining({ code: 'obsolete_payload_schema_version', meta: { changeId, member: 'payloadSchemaVersion' } })]);
    });
  });

  describe('the complete dates of an affiliation, replaced by partial ones without a translation', () => {
    const AFFILIATIONS = 'artist_organization_affiliations';
    const affiliation = (organization: string, startedAt: unknown) => ({
      organization: { entity_id: organization },
      relationshipType: 'agency',
      startedAt,
      endedAt: null,
      status: 'current',
      description: null,
    });
    let diego: Account;
    let moderator: Account;

    beforeEach(async () => {
      await app.reset();
      const admin = await registerFirstAdmin(app);
      diego = await registerVerified(app, 'diego_papi');
      moderator = await registerVerified(app, 'modera_ana');
      await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    });

    /** Applies a microchange through a proposal of its own, and returns its result. */
    async function publish(change: ChangeInput): Promise<object> {
      const proposalId = await createDraft(app, diego.accessToken);
      const added = await addChange(app, diego.accessToken, proposalId, change).expect(201);
      await addSource(app, diego.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, diego.accessToken, proposalId).expect(200);
      const decided = await decideChange(app, moderator.accessToken, added.body.data.id, { action: 'apply' }, '?include=revision').expect(201);
      return decided.body.included[0].attributes.resultKey;
    }

    /** An artist and an agency, both published. */
    async function publishArtistAndAgency(): Promise<{ artist: string; agency: string }> {
      const artist = await reserveIdentity(app, diego.accessToken);
      await publish({ entityId: artist });
      const agency = await reserveIdentity(app, diego.accessToken);
      await publish({ entityId: agency, proposedValue: { exists: true, value: { type: 'organization', displayName: 'EDAM', organization: {} } } });
      await publish({
        entityId: artist,
        operation: 'add_relation',
        targetPath: 'artists',
        targetKey: { catalog_identity_id: { entity_id: artist } },
        proposedValue: { exists: true, value: {} },
      });
      return { artist, agency };
    }

    it.each(['add_relation', 'update_relation'])('keeps listing %s v1 as obsolete, with v2 current', async (operation) => {
      const operations = await listOperations();

      const statusOf = (version: number) => operations.find(({ id }) => id === `identity.${operation}.${AFFILIATIONS}.v${version}`)?.attributes.status;
      expect([statusOf(1), statusOf(2)]).toEqual(['obsolete', 'current']);
    });

    it('leaves the removal in v1, whose payload does not change', async () => {
      const operations = await listOperations();

      const removal = operations.filter(({ id }) => id.startsWith(`identity.remove_relation.${AFFILIATIONS}.`));
      expect(removal.map(({ id, attributes }) => [id, attributes.status])).toEqual([[`identity.remove_relation.${AFFILIATIONS}.v1`, 'current']]);
    });

    it('refuses an addition and an update in v1', async () => {
      const { artist, agency } = await publishArtistAndAgency();
      const resultKey = await publish({
        entityId: artist,
        operation: 'add_relation',
        targetPath: AFFILIATIONS,
        proposedValue: { exists: true, value: affiliation(agency, { year: 2008 }) },
      });
      const proposalId = await createDraft(app, diego.accessToken);
      const inV1 = { entityId: artist, targetPath: AFFILIATIONS, payloadSchemaVersion: 1, proposedValue: { exists: true, value: affiliation(agency, '2008-09-18') } };

      const addition = await addChange(app, diego.accessToken, proposalId, { ...inV1, operation: 'add_relation' }).expect(422);
      const update = await addChange(app, diego.accessToken, proposalId, { ...inV1, operation: 'update_relation', targetKey: resultKey }).expect(422);

      for (const { body } of [addition, update]) {
        expect(body.errors).toEqual([
          expect.objectContaining({ code: 'obsolete_payload_schema_version', source: { pointer: '/data/attributes/payloadSchemaVersion' } }),
        ]);
      }
    });

    it('still removes an affiliation in v1', async () => {
      const { artist, agency } = await publishArtistAndAgency();
      const resultKey = await publish({
        entityId: artist,
        operation: 'add_relation',
        targetPath: AFFILIATIONS,
        proposedValue: { exists: true, value: affiliation(agency, { year: 2008 }) },
      });

      await publish({
        entityId: artist,
        operation: 'remove_relation',
        targetPath: AFFILIATIONS,
        targetKey: resultKey,
        payloadSchemaVersion: 1,
        proposedValue: { exists: false },
      });
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
