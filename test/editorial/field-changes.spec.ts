import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  reserveIdentity,
  submitIdentityCreation,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;

describe('field changes', () => {
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

  /** Publishes IU, a person 162 cm tall, and returns her editorial root and public id. */
  async function publishPerson(): Promise<{ entityId: string; publicId: string }> {
    const { entityId, changeId } = await submitIdentityCreation(app, ana.accessToken);
    const response = await decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision').expect(201);
    return { entityId, publicId: response.body.included[0].attributes.resultKey.publicId };
  }

  /** POST of a `set_fields` to a draft. */
  function addFieldChange(account: Account, proposalId: string, entityId: string, targetPath: string, value: unknown) {
    return addChange(app, account.accessToken, proposalId, { entityId, operation: 'set_fields', targetPath, proposedValue: { exists: true, value } });
  }

  /** A draft of the given account with one `set_fields` per entry and a source, ready to submit. */
  async function draftFieldChanges(
    account: Account,
    entityId: string,
    fields: Record<string, unknown>,
  ): Promise<{ proposalId: string; changeIds: string[] }> {
    const proposalId = await createDraft(app, account.accessToken, 'Corrección de datos');
    const changeIds: string[] = [];
    for (const [targetPath, value] of Object.entries(fields)) {
      const { body } = await addFieldChange(account, proposalId, entityId, targetPath, value).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, account.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    return { proposalId, changeIds };
  }

  async function submitFieldChanges(account: Account, entityId: string, fields: Record<string, unknown>) {
    const ids = await draftFieldChanges(account, entityId, fields);
    await submitProposal(app, account.accessToken, ids.proposalId).expect(200);
    return ids;
  }

  async function decisionHistory(changeId: string) {
    const { body } = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions`, moderator.accessToken).expect(200);
    return body.data.map(({ attributes }: { attributes: object }) => attributes);
  }

  async function identity(publicId: string) {
    const { body } = await getJsonApi(app, `/v1/identities/${publicId}`).expect(200);
    return body.data.attributes;
  }

  /** The review state of each microchange of a proposal, as its author sees it. */
  async function statuses(author: Account, proposalId: string): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/proposals/${proposalId}/changes`, author.accessToken).expect(200);
    return body.data.map((change: { attributes: { status: string } }) => change.attributes.status);
  }

  async function rootVersion(entityId: string): Promise<number> {
    const { body } = await getJsonApi(app, `/v1/editorial-entities/${entityId}`).expect(200);
    return body.data.attributes.currentVersion;
  }

  describe('applying a field change whose base did not change', () => {
    it('writes the field and records the value it replaced in a revision', async () => {
      const { entityId, publicId } = await publishPerson();
      const { changeIds } = await submitFieldChanges(luis, entityId, { 'people.height_cm': 170 });
      app.clock.advance(MINUTE);

      const response = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

      expect(response.body.data[0].attributes).toEqual(
        expect.objectContaining({
          action: 'apply',
          resultingStatus: 'applied',
          observedVersion: 1,
          observedValue: { exists: true, value: 162 },
        }),
      );
      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({
          version: 2,
          beforeValue: { exists: true, value: 162 },
          afterValue: { exists: true, value: 170 },
          resultKey: null,
        }),
      );
      expect(await identity(publicId)).toEqual(
        expect.objectContaining({
          person: expect.objectContaining({ heightCm: 170, givenName: 'Ji-eun' }),
          updatedAt: '2026-01-01T00:01:00.000Z',
        }),
      );
      expect(await rootVersion(entityId)).toBe(2);
    });
  });

  describe('two heights from the same base', () => {
    it('applies the first and leaves the second in conflict, then rebases it on explicit confirmation', async () => {
      const { entityId, publicId } = await publishPerson();
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const second = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });

      app.clock.advance(MINUTE);
      await decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }).expect(201);

      expect(await statuses(luis, second.proposalId)).toEqual(['conflicted']);
      const history = await getJsonApi(app, `/v1/proposal-changes/${second.changeIds[0]}/decisions`, luis.accessToken).expect(200);
      expect(history.body.data).toEqual([
        expect.objectContaining({
          attributes: expect.objectContaining({
            action: 'mark_conflict',
            previousStatus: 'pending',
            resultingStatus: 'conflicted',
            reason: expect.stringContaining('people.height_cm'),
            observedVersion: 2,
            observedValue: { exists: true, value: 172 },
          }),
          relationships: expect.objectContaining({ actor: { data: null } }),
        }),
      ]);
      expect((await identity(publicId)).person.heightCm).toBe(172);

      // A plain apply never overwrites a conflicted base.
      const plain = await decideChange(app, moderator.accessToken, second.changeIds[0], { action: 'apply' }).expect(409);
      expect(plain.body.errors[0].code).toBe('base_changed');
      expect((await identity(publicId)).person.heightCm).toBe(172);

      app.clock.advance(MINUTE);
      const rebased = await decideChange(
        app,
        moderator.accessToken,
        second.changeIds[0],
        { action: 'apply_rebased', confirmedVersion: 2, reason: 'La fuente nueva es más reciente' },
        '?include=revision',
      ).expect(201);

      expect(rebased.body.data[0].attributes).toEqual(
        expect.objectContaining({
          action: 'apply_rebased',
          previousStatus: 'conflicted',
          resultingStatus: 'applied',
          observedVersion: 2,
          observedValue: { exists: true, value: 172 },
        }),
      );
      expect(rebased.body.included[0].attributes).toEqual(
        expect.objectContaining({ version: 3, beforeValue: { exists: true, value: 172 }, afterValue: { exists: true, value: 175 } }),
      );
      // The author's proposal still says it started from 162.
      const change = await getJsonApi(app, `/v1/proposals/${second.proposalId}/changes`, luis.accessToken).expect(200);
      expect(change.body.data[0].attributes).toEqual(
        expect.objectContaining({ baseVersion: 1, baseValue: { exists: true, value: 162 }, proposedValue: { exists: true, value: 175 } }),
      );
      expect((await identity(publicId)).person.heightCm).toBe(175);
      expect(await rootVersion(entityId)).toBe(3);
    });

    it('detects at apply time a base that changed before the competing proposal was submitted', async () => {
      const { entityId, publicId } = await publishPerson();
      const late = await draftFieldChanges(luis, entityId, { 'people.height_cm': 175 });
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      await decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }).expect(201);
      await submitProposal(app, luis.accessToken, late.proposalId).expect(200);
      expect(await statuses(luis, late.proposalId)).toEqual(['pending']);

      const response = await decideChange(app, moderator.accessToken, late.changeIds[0], { action: 'apply' }).expect(409);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'base_changed', meta: expect.objectContaining({ currentVersion: 2, currentValue: { exists: true, value: 172 } }) }),
      );
      // The conflict is recorded although the request failed, with the context it observed.
      expect(await statuses(luis, late.proposalId)).toEqual(['conflicted']);
      expect(await decisionHistory(late.changeIds[0])).toEqual([
        expect.objectContaining({ action: 'mark_conflict', observedVersion: 2, observedValue: { exists: true, value: 172 } }),
      ]);
      expect((await identity(publicId)).person.heightCm).toBe(172);
      expect(await rootVersion(entityId)).toBe(2);
    });

    it('detects a base that changed and came back to its value', async () => {
      const { entityId } = await publishPerson();
      const late = await draftFieldChanges(luis, entityId, { 'people.height_cm': 175 });
      const away = await submitFieldChanges(ana, entityId, { 'people.height_cm': 170 });
      await decideChange(app, moderator.accessToken, away.changeIds[0], { action: 'apply' }).expect(201);
      const back = await submitFieldChanges(ana, entityId, { 'people.height_cm': 162 });
      await decideChange(app, moderator.accessToken, back.changeIds[0], { action: 'apply' }).expect(201);
      await submitProposal(app, luis.accessToken, late.proposalId).expect(200);

      const response = await decideChange(app, moderator.accessToken, late.changeIds[0], { action: 'apply' }).expect(409);

      expect(response.body.errors[0].meta).toEqual({ changeId: late.changeIds[0], entityId, currentVersion: 3, currentValue: { exists: true, value: 162 } });
    });

    it('refuses a confirmation of a version that is no longer current', async () => {
      const { entityId, publicId } = await publishPerson();
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const second = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });
      await decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }).expect(201);
      // The root moves on after the moderator looked at it, even in another field.
      const bio = await submitFieldChanges(ana, entityId, { 'catalog_identities.bio': 'Cantautora.' });
      await decideChange(app, admin.accessToken, bio.changeIds[0], { action: 'apply' }).expect(201);

      const attributes = { action: 'apply_rebased', confirmedVersion: 2, reason: 'Fuente más reciente' };
      const response = await decideChange(app, moderator.accessToken, second.changeIds[0], attributes).expect(409);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'stale_confirmation', meta: { changeId: second.changeIds[0], entityId, currentVersion: 3, currentValue: { exists: true, value: 172 } } }),
      );
      expect((await identity(publicId)).person.heightCm).toBe(172);
      expect(await statuses(luis, second.proposalId)).toEqual(['conflicted']);
      await decideChange(app, moderator.accessToken, second.changeIds[0], { ...attributes, confirmedVersion: 3 }).expect(201);
    });

    it('rebases only a microchange whose base changed', async () => {
      const { entityId } = await publishPerson();
      const { changeIds } = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });

      const attributes = { action: 'apply_rebased', confirmedVersion: 1, reason: 'Sin motivo' };
      const response = await decideChange(app, moderator.accessToken, changeIds[0], attributes).expect(409);

      expect(response.body.errors[0].code).toBe('base_unchanged');
    });

    it('requires a confirmed version and a reason to rebase, and takes a version only then', async () => {
      const { entityId } = await publishPerson();
      const { changeIds } = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });

      for (const [attributes, code, pointer] of [
        [{ action: 'apply_rebased', reason: 'Fuente' }, 'confirmed_version_required', 'confirmedVersion'],
        [{ action: 'apply_rebased', confirmedVersion: 1 }, 'reason_required', 'reason'],
        [{ action: 'apply', confirmedVersion: 1 }, 'confirmed_version_not_allowed', 'confirmedVersion'],
      ] as const) {
        const response = await decideChange(app, moderator.accessToken, changeIds[0], attributes).expect(422);
        expect(response.body.errors).toEqual([expect.objectContaining({ code, source: { pointer: `/data/attributes/${pointer}` } })]);
      }
      const invalid = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply_rebased', confirmedVersion: -1, reason: 'x' }).expect(422);
      expect(invalid.body.errors[0].source).toEqual({ pointer: '/data/attributes/confirmedVersion' });
    });
  });

  describe('identical proposals', () => {
    it('satisfies the second without a write or a new version', async () => {
      const { entityId } = await publishPerson();
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const second = await submitFieldChanges(luis, entityId, { 'people.height_cm': 172 });
      app.clock.advance(MINUTE);

      await decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }).expect(201);

      expect(await statuses(luis, second.proposalId)).toEqual(['satisfied']);
      expect(await decisionHistory(second.changeIds[0])).toEqual([
        expect.objectContaining({ action: 'mark_satisfied', previousStatus: 'pending', resultingStatus: 'satisfied', reason: null, observedVersion: 2 }),
      ]);
      const proposal = await getJsonApi(app, `/v1/proposals/${second.proposalId}`).expect(200);
      expect(proposal.body.data.attributes).toEqual(expect.objectContaining({ status: 'closed', closedAt: '2026-01-01T00:01:00.000Z' }));
      expect(await rootVersion(entityId)).toBe(2);
    });

    it('satisfies a microchange whose result already exists when staff apply it', async () => {
      const { entityId, publicId } = await publishPerson();
      const { proposalId, changeIds } = await submitFieldChanges(luis, entityId, { 'people.height_cm': 162 });

      const response = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

      expect(response.body.data[0].attributes).toEqual(expect.objectContaining({ action: 'mark_satisfied', resultingStatus: 'satisfied' }));
      expect(response.body.data[0].relationships).toEqual(
        expect.objectContaining({ actor: { data: null }, revision: { data: null } }),
      );
      expect(await statuses(luis, proposalId)).toEqual(['satisfied']);
      expect(await rootVersion(entityId)).toBe(1);
      expect((await identity(publicId)).updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('satisfies a conflicted microchange once the field holds its value', async () => {
      const { entityId } = await publishPerson();
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const second = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });
      await decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }).expect(201);
      const third = await submitFieldChanges(ana, entityId, { 'people.height_cm': 175 });
      app.clock.advance(MINUTE);

      await decideChange(app, moderator.accessToken, third.changeIds[0], { action: 'apply' }).expect(201);

      expect(await statuses(luis, second.proposalId)).toEqual(['satisfied']);
      expect((await decisionHistory(second.changeIds[0])).map(({ action }: { action: string }) => action)).toEqual([
        'mark_conflict',
        'mark_satisfied',
      ]);
    });
  });

  describe('height and biography from the same base', () => {
    it('applies both although the version of the root advances', async () => {
      const { entityId, publicId } = await publishPerson();
      const height = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const bio = await submitFieldChanges(luis, entityId, { 'catalog_identities.bio': 'Cantautora y actriz.' });

      await decideChange(app, moderator.accessToken, height.changeIds[0], { action: 'apply' }).expect(201);
      expect(await statuses(luis, bio.proposalId)).toEqual(['pending']);
      const response = await decideChange(app, moderator.accessToken, bio.changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({ version: 3, beforeValue: { exists: true, value: 'Cantante y actriz surcoreana.' } }),
      );
      expect(await identity(publicId)).toEqual(
        expect.objectContaining({ bio: 'Cantautora y actriz.', person: expect.objectContaining({ heightCm: 172 }) }),
      );
    });
  });

  describe('simultaneous application', () => {
    it('applies a microchange once when two moderators apply it at the same time', async () => {
      const { entityId } = await publishPerson();
      const { changeIds } = await submitFieldChanges(luis, entityId, { 'people.height_cm': 172 });

      const responses = await Promise.all(
        [moderator, admin].map((account) => decideChange(app, account.accessToken, changeIds[0], { action: 'apply' })),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(await rootVersion(entityId)).toBe(2);
      expect(await decisionHistory(changeIds[0])).toHaveLength(1);
    });

    it('applies only one of two competing heights decided at the same time', async () => {
      const { entityId, publicId } = await publishPerson();
      const first = await submitFieldChanges(ana, entityId, { 'people.height_cm': 172 });
      const second = await submitFieldChanges(luis, entityId, { 'people.height_cm': 175 });

      const responses = await Promise.all([
        decideChange(app, moderator.accessToken, first.changeIds[0], { action: 'apply' }),
        decideChange(app, admin.accessToken, second.changeIds[0], { action: 'apply' }),
      ]);

      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(responses.find(({ status }) => status === 409)!.body.errors[0].code).toBe('base_changed');
      expect(await rootVersion(entityId)).toBe(2);
      const winner = responses[0].status === 201 ? 172 : 175;
      expect((await identity(publicId)).person.heightCm).toBe(winner);
      const outcomes = [...(await statuses(ana, first.proposalId)), ...(await statuses(luis, second.proposalId))];
      expect(outcomes.sort()).toEqual(['applied', 'conflicted']);
    });
  });

  describe('fields of identities in the registry', () => {
    it('changes a partial date as one group of year, month and day', async () => {
      const entityId = await reserveIdentity(app, ana.accessToken);
      const proposalId = await createDraft(app, ana.accessToken, 'Alta de EDAM');
      const creation = { exists: true, value: { type: 'organization', displayName: 'EDAM', organization: { founding: { year: 2015, month: 3 } } } };
      const { body } = await addChange(app, ana.accessToken, proposalId, { entityId, proposedValue: creation }).expect(201);
      await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, ana.accessToken, proposalId).expect(200);
      const created = await decideChange(app, moderator.accessToken, body.data.id, { action: 'apply' }, '?include=revision').expect(201);
      const { publicId } = created.body.included[0].attributes.resultKey;

      const { changeIds } = await submitFieldChanges(luis, entityId, { 'organizations.founding': { year: 2014 } });
      const response = await decideChange(app, moderator.accessToken, changeIds[0], { action: 'apply' }, '?include=revision').expect(201);

      expect(response.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: true, value: { year: 2015, month: 3 } }, afterValue: { exists: true, value: { year: 2014 } } }),
      );
      expect((await identity(publicId)).organization.founding).toEqual({ year: 2014, month: null, day: null });
    });

    it('lists the field changes with the JSON Schema of each value', async () => {
      const { body } = await getJsonApi(app, '/v1/editorial-operations').expect(200);

      const height = body.data.find(({ id }: { id: string }) => id === 'identity.set_fields.people.height_cm.v1');
      expect(height.attributes).toEqual(
        expect.objectContaining({ operation: 'set_fields', targetPath: 'people.height_cm', targetKey: null, baseValue: null }),
      );
      expect(height.attributes.payloadSchema.properties.value).toEqual({ type: ['integer', 'null'], minimum: 1, maximum: 300 });
      const paths = body.data.filter(({ attributes }: { attributes: { operation: string } }) => attributes.operation === 'set_fields');
      expect(paths.map(({ attributes }: { attributes: { targetPath: string } }) => attributes.targetPath)).toEqual(
        expect.arrayContaining(['catalog_identities.display_name', 'people.birth_date', 'organizations.founding', 'organizations.origin_country_id']),
      );
      expect(paths.map(({ attributes }: { attributes: { targetPath: string } }) => attributes.targetPath)).not.toContain('catalog_identities.type');
    });
  });

  describe('microchanges of a draft', () => {
    it('records the target as the author saw it as the base', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Altura');

      const response = await addFieldChange(luis, proposalId, entityId, 'people.height_cm', 175).expect(201);

      expect(response.body.data.attributes).toEqual(expect.objectContaining({ baseVersion: 1, baseValue: { exists: true, value: 162 } }));
    });

    it('refuses fields the subtype of the identity lacks', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Fundación');

      const response = await addFieldChange(luis, proposalId, entityId, 'organizations.founding', { year: 2008 }).expect(422);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'inapplicable_target', source: { pointer: '/data/attributes/targetPath' } }),
      ]);
    });

    it('refuses fields outside the registry, such as the type of the identity', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Tipo');

      const response = await addFieldChange(luis, proposalId, entityId, 'catalog_identities.type', 'organization').expect(422);

      expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'unregistered_operation', source: { pointer: '/data/attributes/targetPath' } }));
    });

    it('refuses field changes to a reservation', async () => {
      const entityId = await reserveIdentity(app, luis.accessToken);
      const proposalId = await createDraft(app, luis.accessToken, 'Altura');

      const response = await addFieldChange(luis, proposalId, entityId, 'people.height_cm', 175).expect(422);

      expect(response.body.errors[0].code).toBe('entity_not_published');
    });

    it('refuses two writes of the same field in one proposal', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Altura');
      await addFieldChange(luis, proposalId, entityId, 'people.height_cm', 175).expect(201);

      const response = await addFieldChange(luis, proposalId, entityId, 'people.height_cm', 176).expect(422);

      expect(response.body.errors[0].code).toBe('overlapping_change');
      await addFieldChange(luis, proposalId, entityId, 'people.gender', 'female').expect(201);
    });

    it('validates the value against the schema and the calendar', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Datos');

      for (const [targetPath, value, pointer] of [
        ['people.height_cm', 500, '/data/attributes/proposedValue/value'],
        ['people.birth_date', '1993-02-30', '/data/attributes/proposedValue/value'],
        ['catalog_identities.display_name', '   ', '/data/attributes/proposedValue/value'],
        ['catalog_identities.display_name', null, '/data/attributes/proposedValue/value'],
      ] as const) {
        const response = await addFieldChange(luis, proposalId, entityId, targetPath, value).expect(422);
        expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'invalid_payload', source: { pointer } }));
      }
    });

    it('checks a date against the fields the change leaves as they are', async () => {
      const { entityId } = await publishPerson();
      const proposalId = await createDraft(app, luis.accessToken, 'Fallecimiento');

      const response = await addFieldChange(luis, proposalId, entityId, 'people.death_date', '1990-01-01').expect(422);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'inconsistent_value', source: { pointer: '/data/attributes/proposedValue/value' } }),
      );
    });

    it('checks those fields again when the microchange is applied', async () => {
      const { entityId, publicId } = await publishPerson();
      const death = await submitFieldChanges(luis, entityId, { 'people.death_date': '2000-01-01' });
      const birth = await submitFieldChanges(ana, entityId, { 'people.birth_date': '2001-01-01' });
      await decideChange(app, moderator.accessToken, death.changeIds[0], { action: 'apply' }).expect(201);

      const response = await decideChange(app, moderator.accessToken, birth.changeIds[0], { action: 'apply' }).expect(422);

      expect(response.body.errors[0]).toEqual(expect.objectContaining({ code: 'inconsistent_value', meta: expect.objectContaining({ changeId: birth.changeIds[0] }) }));
      expect((await identity(publicId)).person.birthDate).toBe('1993-05-16');
    });
  });
});
