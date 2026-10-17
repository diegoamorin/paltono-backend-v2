import { Account, changeRole, changeStatus, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  changeDependencies,
  changeSources,
  createDraft,
  createProposal,
  decideChange,
  getJsonApi,
  reserveIdentity,
  removeSource,
  submitIdentityCreation,
  submitProposal,
  updateChange,
  updateProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const ALIASES = 'catalog_identity_aliases';

describe('dependencies, atomic groups and withdrawals', () => {
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

  /** Publishes IU, a person, and returns her editorial root. */
  async function publishPerson(): Promise<string> {
    const { entityId, changeId } = await submitIdentityCreation(app, ana.accessToken);
    await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }).expect(201);
    return entityId;
  }

  const alias = (value: string, overrides: object = {}) => ({ alias: value, isPrimary: false, sortOrder: 0, ...overrides });

  const addAlias = (entityId: string, value: string, overrides: object = {}): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath: ALIASES,
    proposedValue: { exists: true, value: alias(value, overrides) },
  });

  /** A draft of the given account with the given microchanges and a source. */
  async function draftChanges(account: Account, changes: ChangeInput[]) {
    const proposalId = await createDraft(app, account.accessToken, 'Datos de IU');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, account.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    const source = await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    return { proposalId, changeIds, sourceId: source.body.data.id as string };
  }

  /** Submits a draft with the given microchanges and dependencies, each as [dependent, prerequisite] indexes. */
  async function submitChanges(account: Account, changes: ChangeInput[], dependencies: [number, number][] = []) {
    const ids = await draftChanges(account, changes);
    for (const [dependent, prerequisite] of dependencies) {
      await changeDependencies(app, account.accessToken, 'post', ids.changeIds[dependent], [ids.changeIds[prerequisite]]).expect(200);
    }
    await submitProposal(app, account.accessToken, ids.proposalId).expect(200);
    return ids;
  }

  /** The ids of the microchanges each microchange of a proposal depends on, as its author sees them. */
  async function dependenciesOf(author: Account, proposalId: string): Promise<string[][]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, author.accessToken).expect(200);
    return body.data.map((change: { relationships: { dependencies: { data: { id: string }[] } } }) =>
      change.relationships.dependencies.data.map(({ id }) => id),
    );
  }

  describe('declaring dependencies (E14)', () => {
    it('adds and removes dependencies as JSON:API relationships of a draft microchange', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun'), addAlias(entityId, 'Dami', { sortOrder: 1 })]);

      const added = await changeDependencies(app, luis.accessToken, 'post', changeIds[1], [changeIds[0]]).expect(200);
      expect(added.body.data).toEqual([{ type: 'proposal-changes', id: changeIds[0] }]);
      // Adding it again changes nothing.
      await changeDependencies(app, luis.accessToken, 'post', changeIds[1], [changeIds[0].toUpperCase()]).expect(200);
      expect(await dependenciesOf(luis, proposalId)).toEqual([[], [changeIds[0]]]);

      const removed = await changeDependencies(app, luis.accessToken, 'delete', changeIds[1], [changeIds[0]]).expect(200);
      expect(removed.body.data).toEqual([]);
      expect(await dependenciesOf(luis, proposalId)).toEqual([[], []]);
    });

    it('refuses a self-reference, a microchange of another proposal and a cycle, without writing', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [
        addAlias(entityId, 'Lee Ji-eun'),
        addAlias(entityId, 'Dami', { sortOrder: 1 }),
        addAlias(entityId, 'Jieun', { sortOrder: 2 }),
      ]);
      const other = await draftChanges(luis, [addAlias(entityId, 'Lee Jieun', { sortOrder: 3 })]);
      await changeDependencies(app, luis.accessToken, 'post', changeIds[1], [changeIds[0]]).expect(200);
      await changeDependencies(app, luis.accessToken, 'post', changeIds[2], [changeIds[1]]).expect(200);
      const codeOf = async (changeId: string, dependsOn: string[]) =>
        (await changeDependencies(app, luis.accessToken, 'post', changeId, dependsOn).expect(422)).body.errors[0];

      expect(await codeOf(changeIds[0], [changeIds[0]])).toEqual(expect.objectContaining({ code: 'self_dependency', source: { pointer: '/data/0/id' } }));
      expect(await codeOf(changeIds[0], [other.changeIds[0]])).toEqual(expect.objectContaining({ code: 'invalid_dependency', source: { pointer: '/data/0/id' } }));
      expect(await codeOf(changeIds[0], [changeIds[2]])).toEqual(expect.objectContaining({ code: 'dependency_cycle' }));
      expect(await dependenciesOf(luis, proposalId)).toEqual([[], [changeIds[0]], [changeIds[1]]]);
    });

    it('refuses a cycle that only appears when an atomic group collapses', async () => {
      const entityId = await publishPerson();
      const group = '0b7a6f0e-6f0d-4a59-8d0e-6e7d1c2b3a49';
      const { proposalId, changeIds } = await draftChanges(luis, [
        { ...addAlias(entityId, 'Lee Ji-eun'), atomicGroupId: group },
        addAlias(entityId, 'Dami', { sortOrder: 1 }),
        { ...addAlias(entityId, 'Jieun', { sortOrder: 2 }), atomicGroupId: group },
      ]);
      // The second needs the first, and the third member of the group needs the second.
      await changeDependencies(app, luis.accessToken, 'post', changeIds[1], [changeIds[0]]).expect(200);
      const response = await changeDependencies(app, luis.accessToken, 'post', changeIds[2], [changeIds[1]]).expect(422);
      expect(response.body.errors[0].code).toBe('dependency_cycle');

      // Joining the group later is refused the same way.
      const ungrouped = await addChange(app, luis.accessToken, proposalId, addAlias(entityId, 'IU', { sortOrder: 4 })).expect(201);
      await changeDependencies(app, luis.accessToken, 'post', ungrouped.body.data.id, [changeIds[1]]).expect(200);
      const joined = await updateChange(app, luis.accessToken, proposalId, ungrouped.body.data.id, { atomicGroupId: group }).expect(422);
      expect(joined.body.errors[0]).toEqual(expect.objectContaining({ code: 'dependency_cycle', source: { pointer: '/data/attributes/atomicGroupId' } }));
    });

    it('freezes dependencies with the submission and hides a draft from anyone else', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun'), addAlias(entityId, 'Dami', { sortOrder: 1 })]);

      await changeDependencies(app, ana.accessToken, 'post', changeIds[1], [changeIds[0]]).expect(404);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);
      const frozen = await changeDependencies(app, luis.accessToken, 'post', changeIds[1], [changeIds[0]]).expect(409);
      expect(frozen.body.errors[0].code).toBe('proposal_submitted');
    });
  });

  describe('linking sources to microchanges (E16)', () => {
    it('links and unlinks general sources of the same proposal, publicly once submitted', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds, sourceId } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);

      const linked = await changeSources(app, luis.accessToken, 'post', changeIds[0], [sourceId]).expect(200);
      expect(linked.body.data).toEqual([{ type: 'proposal-sources', id: sourceId }]);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);

      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`).expect(200);
      expect(body.data[0].relationships.sources.data).toEqual([{ type: 'proposal-sources', id: sourceId }]);
      await changeSources(app, luis.accessToken, 'delete', changeIds[0], [sourceId]).expect(409);
    });

    it('refuses a source of another proposal', async () => {
      const entityId = await publishPerson();
      const { changeIds } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);
      const other = await draftChanges(luis, [addAlias(entityId, 'Dami', { sortOrder: 1 })]);

      const response = await changeSources(app, luis.accessToken, 'post', changeIds[0], [other.sourceId]).expect(422);

      expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'invalid_source', source: { pointer: '/data/0/id' } }));
    });

    it('unlinks a source removed from the draft', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds, sourceId } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);
      await changeSources(app, luis.accessToken, 'post', changeIds[0], [sourceId]).expect(200);

      await removeSource(app, luis.accessToken, proposalId, sourceId).expect(204);

      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, luis.accessToken).expect(200);
      expect(body.data[0].relationships.sources.data).toEqual([]);
    });
  });

  /** The review state of each microchange of a proposal, as its author sees it. */
  async function statuses(author: Account, proposalId: string): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, author.accessToken).expect(200);
    return body.data.map((change: { attributes: { status: string } }) => change.attributes.status);
  }

  /** The decisions on a microchange, oldest first, as staff sees them. */
  async function decisionsOn(changeId: string) {
    const { body } = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, moderator.accessToken).expect(200);
    return body.data.map(({ attributes }: { attributes: object }) => attributes);
  }

  describe('a prerequisite that fails', () => {
    it('blocks its dependents, transitively and with recorded decisions, and leaves independent microchanges available', async () => {
      const korea = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'Corea del Sur' }));
      const published = await publishPerson();
      const entityId = await reserveIdentity(app, luis.accessToken);
      const { proposalId, changeIds } = await draftChanges(luis, [
        { entityId },
        {
          entityId,
          operation: 'add_relation',
          targetPath: 'person_nationalities',
          targetKey: { person_id: { entity_id: entityId }, country_id: korea },
          proposedValue: { exists: true, value: {} },
        },
        addAlias(published, 'Lee Ji-eun'),
        addAlias(published, 'Dami', { sortOrder: 1 }),
      ]);
      // The nationality depends on the creation by its key; the first alias, explicitly on the nationality.
      await changeDependencies(app, luis.accessToken, 'post', changeIds[2], [changeIds[1]]).expect(200);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);

      await decideChange(app, moderator.accessToken, changeIds[0], { action: 'reject', reason: 'Sin fuentes fiables' }).expect(201);

      expect(await statuses(luis, proposalId)).toEqual(['rejected', 'blocked', 'blocked', 'pending']);
      expect(await decisionsOn(changeIds[1])).toEqual([
        expect.objectContaining({ action: 'block_dependency', previousStatus: 'pending', resultingStatus: 'blocked', reason: expect.any(String) }),
      ]);
      const blocked = await getJsonApi(app, `/v1/proposal-changes/${changeIds[2]}/decisions?include=actor`, moderator.accessToken).expect(200);
      expect(blocked.body.data[0].relationships.actor.data).toBeNull();
      await decideChange(app, moderator.accessToken, changeIds[1], { action: 'apply' }).expect(409);
      await decideChange(app, moderator.accessToken, changeIds[3], { action: 'apply' }).expect(201);
      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(body.data.attributes.status).toBe('closed');
    });
  });

  describe('atomic groups', () => {
    const GROUP = '5f1c0f3a-3a51-4c3e-9f0e-2b6f8b0e7d11';

    it('applies the whole group in dependency order when any member is decided, and returns all its decisions', async () => {
      const korea = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'Corea del Sur' }));
      const entityId = await reserveIdentity(app, luis.accessToken);
      const { proposalId, changeIds } = await draftChanges(luis, [
        { entityId, atomicGroupId: GROUP },
        {
          entityId,
          operation: 'add_relation',
          targetPath: 'person_nationalities',
          targetKey: { person_id: { entity_id: entityId }, country_id: korea },
          proposedValue: { exists: true, value: {} },
          atomicGroupId: GROUP,
        },
      ]);
      // The nationality comes first in the proposal's order.
      await updateChange(app, luis.accessToken, proposalId, changeIds[0], { position: 5 }).expect(200);
      await updateChange(app, luis.accessToken, proposalId, changeIds[1], { position: 0 }).expect(200);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);

      const response = await decideChange(app, moderator.accessToken, changeIds[1], { action: 'apply' }, '?include=revision').expect(201);

      // The creation goes first: the nationality names the new person.
      expect(response.body.data.map(({ attributes, relationships }: { attributes: { action: string }; relationships: { change: { data: { id: string } } } }) => [
        relationships.change.data.id,
        attributes.action,
      ])).toEqual([
        [changeIds[0], 'apply'],
        [changeIds[1], 'apply'],
      ]);
      expect(response.body.included.map(({ attributes }: { attributes: { version: number } }) => attributes.version)).toEqual([1, 2]);
      expect(await statuses(luis, proposalId)).toEqual(['applied', 'applied']);
    });

    it('publishes no invalid partial date and no fraction of a failed group, and closes the group together', async () => {
      const entityId = await reserveIdentity(app, ana.accessToken);
      const creation = await draftChanges(ana, [{ entityId, proposedValue: { exists: true, value: { type: 'organization', displayName: 'EDAM', organization: {} } } }]);
      await submitProposal(app, ana.accessToken, creation.proposalId).expect(200);
      await decideChange(app, moderator.accessToken, creation.changeIds[0], { action: 'apply' }).expect(201);
      const setDate = (targetPath: string, value: object): ChangeInput => ({
        entityId,
        operation: 'set_fields',
        targetPath,
        proposedValue: { exists: true, value },
        atomicGroupId: GROUP,
      });
      // Each date is valid alone; together the dissolution comes before the founding.
      const { proposalId, changeIds } = await draftChanges(luis, [
        setDate('organizations.founding', { year: 2020, month: 5 }),
        setDate('organizations.dissolution', { year: 2015 }),
      ]);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);

      const failed = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }).expect(422);
      expect(failed.body.errors[0]).toEqual(expect.objectContaining({ code: 'inconsistent_value', meta: expect.objectContaining({ changeId: changeIds[1] }) }));
      expect(await statuses(luis, proposalId)).toEqual(['pending', 'pending']);
      const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(root.body.data.attributes.currentVersion).toBe(1);

      const rejected = await decideChange(app, moderator.accessToken, changeIds[1], { action: 'reject', reason: 'Fechas incompatibles' }).expect(201);
      expect(rejected.body.data.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['rejected', 'rejected']);
      expect(await statuses(luis, proposalId)).toEqual(['rejected', 'rejected']);
    });

    it('keeps the other members pending when one of them is in conflict', async () => {
      const entityId = await publishPerson();
      const competing = await draftChanges(ana, [{ entityId, operation: 'set_fields', targetPath: 'people.height_cm', proposedValue: { exists: true, value: 170 } }]);
      await submitProposal(app, ana.accessToken, competing.proposalId).expect(200);
      const { proposalId, changeIds } = await draftChanges(luis, [
        { ...addAlias(entityId, 'Lee Ji-eun'), atomicGroupId: GROUP },
        { entityId, operation: 'set_fields', targetPath: 'people.height_cm', proposedValue: { exists: true, value: 165 }, atomicGroupId: GROUP },
      ]);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);
      await decideChange(app, moderator.accessToken, competing.changeIds[0], { action: 'apply' }).expect(201);

      const conflict = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }).expect(409);

      expect(conflict.body.errors[0].code).toBe('base_changed');
      expect(await statuses(luis, proposalId)).toEqual(['pending', 'conflicted']);
      const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(root.body.data.attributes.currentVersion).toBe(2);

      // Confirming the new base applies the whole group.
      const rebased = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply_rebased', confirmedVersion: 2, reason: 'Altura revisada' }).expect(201);
      expect(rebased.body.data.map(({ attributes }: { attributes: { action: string } }) => attributes.action)).toEqual(['apply', 'apply_rebased']);
      expect(await statuses(luis, proposalId)).toEqual(['applied', 'applied']);
    });
  });

  describe('withdrawing microchanges', () => {
    it('lets the author withdraw the unresolved microchanges of a partially applied submission, keeping what was applied', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await submitChanges(luis, [
        addAlias(entityId, 'Lee Ji-eun'),
        addAlias(entityId, 'Dami', { sortOrder: 1 }),
        { entityId, operation: 'set_fields', targetPath: 'people.height_cm', proposedValue: { exists: true, value: 165 } },
      ], [[2, 1]]);
      await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }).expect(201);

      const withdrawn = await decideChange(app, luis.accessToken, changeIds[1], { action: 'withdraw_change' }, '?include=actor').expect(201);

      expect(withdrawn.body.data[0].attributes).toEqual(
        expect.objectContaining({ action: 'withdraw_change', previousStatus: 'pending', resultingStatus: 'withdrawn', reason: null }),
      );
      expect(withdrawn.body.included[0].attributes.username).toBe('luis');
      // The height depended on the withdrawn alias.
      expect(await statuses(luis, proposalId)).toEqual(['applied', 'withdrawn', 'blocked']);
      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}`).expect(200);
      expect(body.data.attributes.status).toBe('closed');
      const root = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(root.body.data.attributes.currentVersion).toBe(2);
      await decideChange(app, luis.accessToken, changeIds[0], { action: 'withdraw_change' }).expect(409);
    });

    it('lets staff withdraw too, and refuses anyone else and every other action of the author', async () => {
      const entityId = await publishPerson();
      const { changeIds } = await submitChanges(luis, [addAlias(entityId, 'Lee Ji-eun'), addAlias(entityId, 'Dami', { sortOrder: 1 })]);

      const forbidden = await decideChange(app, ana.accessToken, changeIds[0], { action: 'withdraw_change' }).expect(403);
      expect(forbidden.body.errors[0].code).toBe('not_change_author');
      await decideChange(app, luis.accessToken, changeIds[0], { action: 'apply' }).expect(403);
      await decideChange(app, luis.accessToken, changeIds[0], { action: 'reject', reason: 'Me equivoqué' }).expect(403);

      await decideChange(app, moderator.accessToken, changeIds[0], { action: 'withdraw_change', reason: 'Duplicado' }).expect(201);
    });

    it('refuses a suspended author', async () => {
      const entityId = await publishPerson();
      const { changeIds } = await submitChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);
      await changeStatus(app, admin.accessToken, luis.uuid, { newStatus: 'suspended', reason: 'Spam' }).expect(201);

      await decideChange(app, luis.accessToken, changeIds[0], { action: 'withdraw_change' }).expect(401);
    });
  });

  describe('an applied dependency', () => {
    it('unblocks only while its result still holds', async () => {
      const entityId = await publishPerson();
      const { changeIds } = await submitChanges(luis, [addAlias(entityId, 'Lee Ji-eun'), addAlias(entityId, 'Dami', { sortOrder: 1 })], [[1, 0]]);
      const inserted = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);
      const { id } = inserted.body.included[0].attributes.resultKey;
      // Another submission removes the alias the dependency inserted.
      const removal = await submitChanges(ana, [
        { entityId, operation: 'remove_relation', targetPath: ALIASES, targetKey: { id }, proposedValue: { exists: false } },
      ]);
      await decideChange(app, moderator.accessToken, removal.changeIds[0], { action: 'apply' }).expect(201);

      const conflict = await decideChange(app, moderator.accessToken, changeIds[1], { action: 'apply' }).expect(409);
      expect(conflict.body.errors[0].code).toBe('base_changed');
      expect((await decisionsOn(changeIds[1]))[0]).toEqual(
        expect.objectContaining({ action: 'mark_conflict', reason: `La fila que escribió el microcambio ${changeIds[0]}, del que depende, ya no existe` }),
      );
      const rebased = await decideChange(app, moderator.accessToken, changeIds[1], {
        action: 'apply_rebased',
        confirmedVersion: 3,
        reason: 'Aplicar igualmente',
      }).expect(409);
      expect(rebased.body.errors[0].code).toBe('constraint_violated');
    });
  });

  describe('submitting dependencies', () => {
    it('refuses a cycle formed with the dependencies that references imply', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);
      const removal = await addChange(app, luis.accessToken, proposalId, {
        entityId,
        operation: 'remove_relation',
        targetPath: ALIASES,
        targetKey: { id: { change_id: changeIds[0] } },
        proposedValue: { exists: false },
      }).expect(201);
      // The insertion cannot wait for the removal of the row it creates.
      await changeDependencies(app, luis.accessToken, 'post', changeIds[0], [removal.body.data.id]).expect(200);

      const response = await submitProposal(app, luis.accessToken, proposalId).expect(422);

      expect(response.body.errors[0].code).toBe('dependency_cycle');
      const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}`, luis.accessToken).expect(200);
      expect(body.data.attributes.status).toBe('draft');
    });
  });

  describe('correcting a submission', () => {
    it('points to an earlier submission of the same author, never to a draft such as itself', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges(luis, [addAlias(entityId, 'Lee Ji-eun')]);
      const previous = (id: string) => ({ previousProposal: { data: { type: 'proposals', id } } });
      const correction = await createProposal(app, luis.accessToken, { description: 'Corrección' }, previous(first.proposalId)).expect(201);
      const correctionId = correction.body.data.id;

      const itself = await updateProposal(app, luis.accessToken, correctionId, {}, previous(correctionId)).expect(422);
      expect(itself.body.errors[0].code).toBe('invalid_previous_proposal');
      await createProposal(app, ana.accessToken, { description: 'Ajena' }, previous(first.proposalId)).expect(422);
    });
  });
});
