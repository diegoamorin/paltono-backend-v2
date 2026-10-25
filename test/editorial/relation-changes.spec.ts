import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  removeChange,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
  updateChange,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const ALIASES = 'catalog_identity_aliases';
const NATIONALITIES = 'person_nationalities';

describe('relation changes', () => {
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

  /** A draft of the given account with the given microchanges and a source, ready to submit. */
  async function draftChanges(account: Account, changes: ChangeInput[]): Promise<{ proposalId: string; changeIds: string[] }> {
    const proposalId = await createDraft(app, account.accessToken, 'Datos de IU');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, account.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    return { proposalId, changeIds };
  }

  async function submitChanges(account: Account, changes: ChangeInput[]) {
    const ids = await draftChanges(account, changes);
    await submitProposal(app, account.accessToken, ids.proposalId).expect(200);
    return ids;
  }

  const addAlias = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath: ALIASES,
    proposedValue: { exists: true, value },
  });

  const updateAlias = (entityId: string, targetKey: object, value: object): ChangeInput => ({
    entityId,
    operation: 'update_relation',
    targetPath: ALIASES,
    targetKey,
    proposedValue: { exists: true, value },
  });

  const removeAlias = (entityId: string, targetKey: object): ChangeInput => ({
    entityId,
    operation: 'remove_relation',
    targetPath: ALIASES,
    targetKey,
    proposedValue: { exists: false },
  });

  function apply(changeId: string) {
    return decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  }

  /** Publishes an alias of the root through its own submission and returns the row's id. */
  async function publishAlias(entityId: string, value: object): Promise<number> {
    const { changeIds } = await submitChanges(ana, [addAlias(entityId, value)]);
    return (await apply(changeIds[0]).expect(201)).body.included[0].attributes.resultKey.id;
  }

  /** The review state of each microchange of a proposal, as its author sees it. */
  async function statuses(author: Account, proposalId: string): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, author.accessToken).expect(200);
    return body.data.map((change: { attributes: { status: string } }) => change.attributes.status);
  }

  describe('adding an alias', () => {
    it('inserts the row and keeps its generated key in the revision', async () => {
      const entityId = await publishPerson();
      const { changeIds } = await submitChanges(luis, [addAlias(entityId, alias('Lee Ji-eun'))]);

      const response = await apply(changeIds[0]).expect(201);

      expect(response.body.data[0].attributes).toEqual(
        expect.objectContaining({ action: 'apply', resultingStatus: 'applied', observedValue: { exists: false } }),
      );
      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          version: 2,
          beforeValue: { exists: false },
          afterValue: { exists: true, value: alias('Lee Ji-eun') },
          resultKey: { id: expect.any(Number) },
        }),
      );
    });
  });

  describe('comparing insertions by keys and constraints', () => {
    it('applies two different aliases from the same base', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges(ana, [addAlias(entityId, alias('Lee Ji-eun'))]);
      const second = await submitChanges(luis, [addAlias(entityId, alias('Dami', { sortOrder: 1 }))]);

      await apply(first.changeIds[0]).expect(201);
      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('applied');
    });

    it('closes an identical insertion as satisfied, without a write or a version', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges(ana, [addAlias(entityId, alias('Lee Ji-eun'))]);
      const second = await submitChanges(luis, [addAlias(entityId, alias('Lee Ji-eun'))]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes).toEqual(expect.objectContaining({ action: 'mark_satisfied', resultingStatus: 'satisfied' }));
      expect(response.body.included ?? []).toEqual([]);
      const { body } = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
      expect(body.data.attributes.currentVersion).toBe(2);
    });

    it('leaves in conflict an insertion that breaks the uniqueness of the spelling, and never applies it over a new base', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges(ana, [addAlias(entityId, alias('Lee Ji-eun'))]);
      const second = await submitChanges(luis, [addAlias(entityId, alias('Lee Ji-eun', { sortOrder: 4 }))]);
      await apply(first.changeIds[0]).expect(201);

      const conflict = await apply(second.changeIds[0]).expect(409);
      expect(conflict.body.errors[0].code).toBe('base_changed');
      const history = await getJsonApi(app, `/v1/proposal-changes/${second.changeIds[0]}/decisions`, luis.accessToken).expect(200);
      expect(history.body.data[0].attributes).toEqual(
        expect.objectContaining({
          action: 'mark_conflict',
          reason: 'La identidad ya tiene el alias «Lee Ji-eun»',
          observedValue: { exists: true, value: alias('Lee Ji-eun') },
        }),
      );

      const rebased = await decideChange(app, moderator.accessToken, second.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 2,
        reason: 'Orden distinto',
      }).expect(409);
      expect(rebased.body.errors[0].code).toBe('constraint_violated');
      expect(await statuses(luis, second.proposalId)).toEqual(['conflicted']);
    });

    it('leaves in conflict a second primary alias', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges(ana, [addAlias(entityId, alias('Lee Ji-eun', { isPrimary: true }))]);
      const second = await submitChanges(luis, [addAlias(entityId, alias('Dami', { isPrimary: true }))]);
      await apply(first.changeIds[0]).expect(201);

      await apply(second.changeIds[0]).expect(409);

      expect(await statuses(luis, second.proposalId)).toEqual(['conflicted']);
    });
  });

  describe('overlapping writes in one proposal', () => {
    it('refuses a second insertion of the same alias', async () => {
      const entityId = await publishPerson();
      const { proposalId } = await draftChanges(luis, [addAlias(entityId, alias('Lee Ji-eun'))]);

      const response = await addChange(app, luis.accessToken, proposalId, addAlias(entityId, alias('Lee Ji-eun', { sortOrder: 1 }))).expect(422);

      expect(response.body.errors[0].code).toBe('overlapping_change');
    });

    it('refuses a second change to the same row however its reference is spelled', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [addAlias(entityId, alias('Lee Ji-eun'))]);
      await addChange(app, luis.accessToken, proposalId, removeAlias(entityId, { id: { change_id: changeIds[0] } })).expect(201);

      const response = await addChange(
        app,
        luis.accessToken,
        proposalId,
        updateAlias(entityId, { id: { change_id: changeIds[0].toUpperCase() } }, alias('Jieun')),
      ).expect(422);

      expect(response.body.errors[0].code).toBe('overlapping_change');
    });
  });

  describe('updating an alias', () => {
    it('selects the row by its primary key and starts from its current values', async () => {
      const entityId = await publishPerson();
      const id = await publishAlias(entityId, alias('Lee Ji-eun'));
      const { proposalId, changeIds } = await submitChanges(luis, [updateAlias(entityId, { id }, alias('Lee Ji-eun', { isPrimary: true }))]);

      const change = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, luis.accessToken).expect(200);
      expect(change.body.data[0].attributes).toEqual(
        expect.objectContaining({ targetKey: { id }, baseVersion: 2, baseValue: { exists: true, value: alias('Lee Ji-eun') } }),
      );

      const response = await apply(changeIds[0]).expect(201);
      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          version: 3,
          beforeValue: { exists: true, value: alias('Lee Ji-eun') },
          afterValue: { exists: true, value: alias('Lee Ji-eun', { isPrimary: true }) },
          resultKey: { id },
        }),
      );
    });

    it('refuses a key that names no row of the root', async () => {
      const entityId = await publishPerson();
      const other = await publishPerson();
      const id = await publishAlias(other, alias('Dami'));
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');

      const response = await addChange(app, luis.accessToken, proposalId, updateAlias(entityId, { id }, alias('Dami'))).expect(422);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'relation_row_not_found', source: { pointer: '/data/attributes/targetKey' } }),
      );
    });

    it('conflicts with a change to the same alias, and not with a change to another one', async () => {
      const entityId = await publishPerson();
      const first = await publishAlias(entityId, alias('Lee Ji-eun'));
      const second = await publishAlias(entityId, alias('Dami', { sortOrder: 1 }));
      const ana2 = await submitChanges(ana, [updateAlias(entityId, { id: first }, alias('Lee Ji-eun', { sortOrder: 2 }))]);
      const luisSame = await submitChanges(luis, [updateAlias(entityId, { id: first }, alias('Lee Jieun'))]);
      const luisOther = await submitChanges(luis, [updateAlias(entityId, { id: second }, alias('Dami', { sortOrder: 3 }))]);

      await apply(ana2.changeIds[0]).expect(201);

      const conflict = await apply(luisSame.changeIds[0]).expect(409);
      expect(conflict.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'base_changed', meta: { changeId: luisSame.changeIds[0], entityId, currentVersion: 4, currentValue: { exists: true, value: alias('Lee Ji-eun', { sortOrder: 2 }) } } }),
      );
      expect(await statuses(luis, luisSame.proposalId)).toEqual(['conflicted']);
      await apply(luisOther.changeIds[0]).expect(201);
    });
  });

  describe('a row not created yet', () => {
    it('is named by its insertion, which the change depends on, and translated to its key when applied', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');
      const insertion = await addChange(app, luis.accessToken, proposalId, addAlias(entityId, alias('Lee Ji-eun'))).expect(201);
      const insertionId = insertion.body.data.id;
      const update = await addChange(
        app,
        luis.accessToken,
        proposalId,
        updateAlias(entityId, { id: { change_id: insertionId } }, alias('Lee Ji-eun', { isPrimary: true })),
      ).expect(201);
      // Its base is the row its insertion proposes.
      expect(update.body.data.attributes.baseValue).toEqual({ exists: true, value: alias('Lee Ji-eun') });
      await addSource(app, luis.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, luis.accessToken, proposalId).expect(200);

      const early = await apply(update.body.data.id).expect(409);
      expect(early.body.errors[0]).toEqual(expect.objectContaining({ code: 'dependency_unresolved', meta: { dependsOn: [insertionId] } }));

      const inserted = await apply(insertionId).expect(201);
      const id = inserted.body.included[0].attributes.resultKey.id;
      const response = await apply(update.body.data.id).expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          beforeValue: { exists: true, value: alias('Lee Ji-eun') },
          afterValue: { exists: true, value: alias('Lee Ji-eun', { isPrimary: true }) },
          resultKey: { id },
        }),
      );
      // The submission keeps the reference as its author wrote it.
      const changes = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, luis.accessToken).expect(200);
      expect(changes.body.data[1].attributes.targetKey).toEqual({ id: { change_id: insertionId } });
    });

    it('follows its insertion when the draft changes the proposed row', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');
      const insertion = await addChange(app, luis.accessToken, proposalId, addAlias(entityId, alias('Lee Ji-eun'))).expect(201);
      const removal = await addChange(app, luis.accessToken, proposalId, removeAlias(entityId, { id: { change_id: insertion.body.data.id } })).expect(201);

      await updateChange(app, luis.accessToken, proposalId, insertion.body.data.id, {
        proposedValue: { exists: true, value: alias('Jieun') },
      }).expect(200);

      const changes = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, luis.accessToken).expect(200);
      const removed = changes.body.data.find(({ id }: { id: string }) => id === removal.body.data.id);
      expect(removed.attributes.baseValue).toEqual({ exists: true, value: alias('Jieun') });
    });

    it('refuses a reference to anything but an insertion of the same relation in the proposal', async () => {
      const entityId = await publishPerson();
      const other = await draftChanges(luis, [addAlias(entityId, alias('Dami'))]);
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');

      const response = await addChange(
        app,
        luis.accessToken,
        proposalId,
        removeAlias(entityId, { id: { change_id: other.changeIds[0] } }),
      ).expect(422);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'invalid_reference', source: { pointer: '/data/attributes/targetKey/id' } }),
      );
    });

    it('refuses to submit a reference whose insertion left the draft', async () => {
      const entityId = await publishPerson();
      const { proposalId, changeIds } = await draftChanges(luis, [addAlias(entityId, alias('Lee Ji-eun'))]);
      await addChange(app, luis.accessToken, proposalId, removeAlias(entityId, { id: { change_id: changeIds[0] } })).expect(201);
      await removeChange(app, luis.accessToken, proposalId, changeIds[0]).expect(204);

      const response = await submitProposal(app, luis.accessToken, proposalId).expect(422);

      expect(response.body.errors[0].code).toBe('invalid_reference');
    });
  });

  describe('nationalities, keyed by person and country', () => {
    const nationality = (operation: 'add_relation' | 'remove_relation', entityId: string, countryId: number): ChangeInput => ({
      entityId,
      operation,
      targetPath: NATIONALITIES,
      targetKey: { person_id: { entity_id: entityId }, country_id: countryId },
      proposedValue: operation === 'add_relation' ? { exists: true, value: {} } : { exists: false },
    });

    async function country(code: string, name: string): Promise<number> {
      return Number(await createdEntryId(app, admin.accessToken, 'countries', { code, name }));
    }

    it('names a new root by its editorial id, depends on its creation and is translated to its key when applied', async () => {
      const korea = await country('KR', 'South Korea');
      const entityId = await reserveIdentity(app, ana.accessToken);
      const proposalId = await createDraft(app, ana.accessToken);
      const creation = await addChange(app, ana.accessToken, proposalId, { entityId }).expect(201);
      const added = await addChange(app, ana.accessToken, proposalId, nationality('add_relation', entityId, korea)).expect(201);
      expect(added.body.data.attributes.baseValue).toEqual({ exists: false });
      await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, ana.accessToken, proposalId).expect(200);

      await apply(added.body.data.id).expect(409);
      const created = await apply(creation.body.data.id).expect(201);
      const response = await apply(added.body.data.id).expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          beforeValue: { exists: false },
          afterValue: { exists: true, value: {} },
          resultKey: { person_id: created.body.included[0].attributes.resultKey.id, country_id: korea },
        }),
      );
    });

    it('removes a nationality by its composite key', async () => {
      const korea = await country('KR', 'South Korea');
      const entityId = await publishPerson();
      const { changeIds } = await submitChanges(ana, [nationality('add_relation', entityId, korea)]);
      await apply(changeIds[0]).expect(201);
      const removal = await submitChanges(luis, [nationality('remove_relation', entityId, korea)]);

      const response = await apply(removal.changeIds[0]).expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: true, value: {} }, afterValue: { exists: false } }),
      );
    });

    it('refuses a key naming another root, an unknown country or a reservation the proposal does not create', async () => {
      const korea = await country('KR', 'South Korea');
      const entityId = await publishPerson();
      const other = await publishPerson();
      const reserved = await reserveIdentity(app, luis.accessToken);
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');
      const pointerOf = async (input: ChangeInput) =>
        (await addChange(app, luis.accessToken, proposalId, input).expect(422)).body.errors.map(
          ({ code, source }: { code: string; source: { pointer: string } }) => `${code} ${source.pointer}`,
        );

      expect(await pointerOf({ ...nationality('add_relation', entityId, korea), targetKey: { person_id: { entity_id: other }, country_id: korea } })).toEqual([
        'invalid_reference /data/attributes/targetKey/person_id',
      ]);
      expect(await pointerOf(nationality('add_relation', entityId, 999))).toEqual(['unknown_vocabulary_entry /data/attributes/targetKey/country_id']);
      expect(await pointerOf(nationality('add_relation', reserved, korea))).toEqual(['invalid_reference /data/attributes/targetKey/person_id']);
    });
  });

  describe('the registry of operations', () => {
    it('publishes the shape of the key of each relation operation', async () => {
      const { body } = await getJsonApi(app, '/v1/editorial-operations').expect(200);
      const byId = (id: string) => body.data.find((operation: { id: string }) => operation.id === id).attributes;

      expect(byId('identity.add_relation.catalog_identity_aliases.v1').targetKey).toBeNull();
      expect(byId('identity.update_relation.catalog_identity_aliases.v1').targetKey.required).toEqual(['id']);
      expect(byId('identity.remove_relation.catalog_identity_aliases.v1').payloadSchema.properties).toEqual({ exists: { const: false } });
      expect(byId('identity.add_relation.person_nationalities.v1').targetKey.required).toEqual(['person_id', 'country_id']);
    });

    it('refuses a key that selects a row by its position', async () => {
      const entityId = await publishPerson();
      await publishAlias(entityId, alias('Lee Ji-eun'));
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');

      for (const targetKey of [{ index: 0 }, [0], { id: 1, position: 0 }]) {
        const response = await addChange(app, luis.accessToken, proposalId, removeAlias(entityId, targetKey)).expect(422);
        expect(response.body.errors[0].code).toBe('invalid_target_key');
      }
    });

    it('refuses payloads that carry keys, authorship, versions or administrative metadata', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Datos de IU');

      for (const extra of [{ id: 7 }, { catalogIdentityId: 1 }, { createdBy: 1 }, { version: 3 }, { status: 'applied' }, { role: 'admin' }]) {
        const response = await addChange(app, luis.accessToken, proposalId, addAlias(entityId, { ...alias('Dami'), ...extra })).expect(422);
        expect(response.body.errors[0]).toEqual(
          expect.objectContaining({ code: 'invalid_payload', source: { pointer: `/data/attributes/proposedValue/value/${Object.keys(extra)[0]}` } }),
        );
      }
    });
  });

  describe('removing an alias', () => {
    it('deletes the row and keeps its former values in the revision', async () => {
      const entityId = await publishPerson();
      const id = await publishAlias(entityId, alias('Lee Ji-eun', { isPrimary: true }));
      const { changeIds } = await submitChanges(luis, [removeAlias(entityId, { id })]);

      const response = await apply(changeIds[0]).expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          beforeValue: { exists: true, value: alias('Lee Ji-eun', { isPrimary: true }) },
          afterValue: { exists: false },
          resultKey: { id },
        }),
      );
      // The row is gone, so a new microchange cannot select it.
      const proposalId = await createDraft(app, ana.accessToken, 'Datos de IU');
      const again = await addChange(app, ana.accessToken, proposalId, removeAlias(entityId, { id })).expect(422);
      expect(again.body.errors[0].code).toBe('relation_row_not_found');
    });

    it('is satisfied when another submission removed the row first', async () => {
      const entityId = await publishPerson();
      const id = await publishAlias(entityId, alias('Lee Ji-eun'));
      const first = await submitChanges(ana, [removeAlias(entityId, { id })]);
      const second = await submitChanges(luis, [removeAlias(entityId, { id })]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes).toEqual(expect.objectContaining({ action: 'mark_satisfied', resultingStatus: 'satisfied' }));
    });
  });
});
