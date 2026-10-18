import { sendJsonApi } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
  WIKIPEDIA,
  addChange,
  addSource,
  createDraft,
  decideChange,
  getJsonApi,
  personCreation,
  reserveEntity,
  reserveIdentity,
  submitProposal,
} from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const work = (value: unknown) => ({ exists: true, value });

describe('works in the editorial flow', () => {
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

  function apply(changeId: string) {
    return decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  }

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos de la obra');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return changeIds;
  }

  const creation = (entityId: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath: 'works',
    proposedValue: work(value),
  });

  async function reserveWork(): Promise<string> {
    return (await reserveEntity(app, ana.accessToken, 'work').expect(201)).body.data.id;
  }

  /** Publishes a work and returns its public id. */
  async function publishWork(value: object): Promise<{ entityId: string; id: string }> {
    const entityId = await reserveWork();
    const [changeId] = await submitChanges([creation(entityId, value)]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.id };
  }

  describe('creation', () => {
    it('publishes a work with a slug generated from its title', async () => {
      const { entityId, id } = await publishWork({ title: 'Butter', iswc: 'T0345246801' });

      const { body } = await getJsonApi(app, `/v1/works/${id}`).expect(200);
      expect(body.data).toEqual({
        type: 'works',
        id,
        attributes: expect.objectContaining({
          publicationStatus: 'published',
          withdrawnAt: null,
          title: 'Butter',
          slug: 'butter',
          description: null,
          iswc: 'T0345246801',
        }),
        relationships: expect.objectContaining({ contributions: { data: [] }, recordingWorks: { data: [] } }),
        meta: { editorialEntityId: entityId },
      });
    });

    it('resolves slug collisions with a suffix and keeps the slug when the title changes', async () => {
      const first = await publishWork({ title: 'Butter' });
      const second = await publishWork({ title: 'BUTTER!' });
      const korean = await publishWork({ title: '좋은 날' });

      expect((await getJsonApi(app, `/v1/works/${second.id}`).expect(200)).body.data.attributes.slug).toBe('butter-2');
      expect((await getJsonApi(app, `/v1/works/${korean.id}`).expect(200)).body.data.attributes.slug).toBe('좋은-날');

      const [changeId] = await submitChanges([
        { entityId: first.entityId, operation: 'set_fields', targetPath: 'works.title', proposedValue: work('Butter (Remix)') },
      ]);
      await apply(changeId).expect(201);
      const { body } = await getJsonApi(app, `/v1/works/${first.id}`).expect(200);
      expect(body.data.attributes).toEqual(expect.objectContaining({ title: 'Butter (Remix)', slug: 'butter' }));
    });

    it('gives distinct slugs to works with the same title applied at the same time', async () => {
      const changeIds: string[] = [];
      for (let index = 0; index < 4; index++) {
        changeIds.push(...(await submitChanges([creation(await reserveWork(), { title: 'Dynamite' })])));
      }

      const responses = await Promise.all(changeIds.map((changeId) => apply(changeId)));

      expect(responses.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
      const { body } = await getJsonApi(app, '/v1/works?sort=title').expect(200);
      expect(body.data.map(({ attributes }: { attributes: { slug: string } }) => attributes.slug).sort()).toEqual([
        'dynamite',
        'dynamite-2',
        'dynamite-3',
        'dynamite-4',
      ]);
    });

    it('validates the title and the format and check digit of the ISWC', async () => {
      const entityId = await reserveWork();
      const proposalId = await createDraft(app, ana.accessToken);

      const blank = await addChange(app, ana.accessToken, proposalId, creation(entityId, { title: '  ' })).expect(422);
      expect(blank.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/title' });
      const format = await addChange(app, ana.accessToken, proposalId, creation(entityId, { title: 'Butter', iswc: 'T-034.524.680-1' })).expect(422);
      expect(format.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/iswc' });
      const checkDigit = await addChange(app, ana.accessToken, proposalId, creation(entityId, { title: 'Butter', iswc: 'T0345246802' })).expect(422);
      expect(checkDigit.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'invalid_payload', source: { pointer: '/data/attributes/proposedValue/value/iswc' } }),
      );
    });

    it('keeps an ISWC unique among works', async () => {
      await publishWork({ title: 'Butter', iswc: 'T0345246801' });
      const entityId = await reserveWork();
      const [changeId] = await submitChanges([creation(entityId, { title: 'Otra', iswc: 'T0345246801' })]);

      const response = await apply(changeId).expect(409);

      expect(response.body.errors[0].code).toBe('base_changed');
    });
  });

  describe('credits', () => {
    const CREDITS = 'work_contributions';
    let composer: number;
    let mixer: number;

    beforeEach(async () => {
      composer = Number(
        await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug: 'composer', name: 'Composición', category: 'writing', scopes: ['work'] }),
      );
      mixer = Number(
        await createdEntryId(app, admin.accessToken, 'contribution-roles', {
          slug: 'mixing-engineer',
          name: 'Mezcla',
          category: 'engineering',
          scopes: ['recording'],
        }),
      );
    });

    /** Publishes a person and returns its editorial root. */
    async function publishIdentity(): Promise<string> {
      const entityId = await reserveIdentity(app, ana.accessToken);
      const [changeId] = await submitChanges([{ entityId, proposedValue: personCreation() }]);
      await apply(changeId).expect(201);
      return entityId;
    }

    const credit = (workRoot: string, value: object, operation = 'add_relation', targetKey?: object): ChangeInput => ({
      entityId: workRoot,
      operation,
      targetPath: CREDITS,
      proposedValue: operation === 'remove_relation' ? { exists: false } : work(value),
      ...(targetKey ? { targetKey } : {}),
    });

    async function withdraw(entityId: string): Promise<void> {
      const proposalId = await createDraft(app, admin.accessToken, 'Retirada');
      await addChange(app, admin.accessToken, proposalId, {
        entityId,
        operation: 'withdraw_entity',
        targetPath: 'publication_status',
        proposedValue: { exists: true, value: 'withdrawn' },
      }).expect(201);
      await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
    }

    it('credits an identity in a role of the work scope, then updates and removes the credit', async () => {
      const { entityId, id } = await publishWork({ title: 'Butter' });
      const identity = await publishIdentity();

      const [added] = await submitChanges([credit(entityId, { identity: { entity_id: identity }, roleId: composer, position: 0, creditedAs: 'Jenna Andrews' })]);
      const addition = await apply(added).expect(201);
      const creditId = addition.body.included[0].attributes.resultKey.id;
      expect(addition.body.included[0].attributes.afterValue).toEqual({
        exists: true,
        value: { identity: { entity_id: identity }, roleId: composer, position: 0, creditedAs: 'Jenna Andrews', details: null, sourceText: null, sourceUrl: null },
      });

      const shown = await getJsonApi(app, `/v1/works/${id}?include=contributions.identity,contributions.role`).expect(200);
      expect(shown.body.data.relationships.contributions).toEqual({ data: [{ type: 'work-contributions', id: String(creditId) }] });
      const included = shown.body.included.map(({ type, attributes }: { type: string; attributes: Record<string, unknown> }) => [
        type,
        attributes.creditedAs ?? attributes.displayName ?? attributes.slug,
      ]);
      expect(included).toEqual(
        expect.arrayContaining([
          ['work-contributions', 'Jenna Andrews'],
          ['identities', 'IU'],
          ['contribution-roles', 'composer'],
        ]),
      );

      const [updated] = await submitChanges([
        credit(entityId, { identity: { entity_id: identity }, roleId: composer, position: 1 }, 'update_relation', { id: creditId }),
      ]);
      await apply(updated).expect(201);
      const [removed] = await submitChanges([credit(entityId, {}, 'remove_relation', { id: creditId })]);
      const removal = await apply(removed).expect(201);
      expect(removal.body.included[0].attributes.beforeValue.value.position).toBe(1);
      expect((await getJsonApi(app, `/v1/works/${id}`).expect(200)).body.data.relationships.contributions).toEqual({ data: [] });
    });

    it('refuses a role outside the work scope, an unknown role and a root that is not an identity', async () => {
      const { entityId } = await publishWork({ title: 'Butter' });
      const identity = await publishIdentity();
      const proposalId = await createDraft(app, ana.accessToken);
      const problem = async (value: object) => {
        const { body } = await addChange(app, ana.accessToken, proposalId, credit(entityId, value)).expect(422);
        return `${body.errors[0].code} ${body.errors[0].source.pointer}`;
      };

      expect(await problem({ identity: { entity_id: identity }, roleId: mixer, position: 0 })).toBe(
        'role_out_of_scope /data/attributes/proposedValue/value/roleId',
      );
      expect(await problem({ identity: { entity_id: identity }, roleId: mixer + 100, position: 0 })).toBe(
        'unknown_vocabulary_entry /data/attributes/proposedValue/value/roleId',
      );
      expect(await problem({ identity: { entity_id: entityId }, roleId: composer, position: 0 })).toBe(
        'invalid_reference /data/attributes/proposedValue/value/identity/entity_id',
      );
    });

    it('credits an identity created in the same proposal only once the identity is published', async () => {
      const { entityId } = await publishWork({ title: 'Butter' });
      const identity = await reserveIdentity(app, ana.accessToken);
      const [creation, added] = await submitChanges([
        { entityId: identity, proposedValue: personCreation() },
        credit(entityId, { identity: { entity_id: identity }, roleId: composer, position: 0 }),
      ]);

      const early = await apply(added).expect(409);
      expect(early.body.errors[0]).toEqual(expect.objectContaining({ code: 'dependency_unresolved', meta: { dependsOn: [creation] } }));
      await apply(creation).expect(201);
      await apply(added).expect(201);
    });

    it('blocks a credit whose identity creation is rejected', async () => {
      const { entityId } = await publishWork({ title: 'Butter' });
      const identity = await reserveIdentity(app, ana.accessToken);
      const [creation, added] = await submitChanges([
        { entityId: identity, proposedValue: personCreation() },
        credit(entityId, { identity: { entity_id: identity }, roleId: composer, position: 0 }),
      ]);

      await decideChange(app, moderator.accessToken, creation, { action: 'reject', reason: 'Sin fuente fiable' }).expect(201);

      const history = await getJsonApi(app, `/v1/proposal-changes/${added}/decisions`, moderator.accessToken).expect(200);
      expect(history.body.data[0].attributes).toEqual(expect.objectContaining({ action: 'block_dependency', resultingStatus: 'blocked' }));
    });

    it('refuses a reservation the proposal does not create and a withdrawn identity', async () => {
      const { entityId } = await publishWork({ title: 'Butter' });
      const reserved = await reserveIdentity(app, ana.accessToken);
      const withdrawn = await publishIdentity();
      await withdraw(withdrawn);

      const draft = await createDraft(app, ana.accessToken);
      const unreferenced = await addChange(app, ana.accessToken, draft, credit(entityId, { identity: { entity_id: reserved }, roleId: composer, position: 0 })).expect(422);
      expect(unreferenced.body.errors[0].code).toBe('invalid_reference');
      const toWithdrawn = await addChange(app, ana.accessToken, draft, credit(entityId, { identity: { entity_id: withdrawn }, roleId: composer, position: 0 })).expect(422);
      expect(toWithdrawn.body.errors[0].code).toBe('entity_withdrawn');
    });

    it('does not apply a credit whose identity was withdrawn after the submission, and shows only the notice of a credited one', async () => {
      const { entityId, id } = await publishWork({ title: 'Butter' });
      const credited = await publishIdentity();
      const [kept] = await submitChanges([credit(entityId, { identity: { entity_id: credited }, roleId: composer, position: 0 })]);
      await apply(kept).expect(201);
      const later = await publishIdentity();
      const [pending] = await submitChanges([credit(entityId, { identity: { entity_id: later }, roleId: composer, position: 1 })]);

      await withdraw(later);
      await withdraw(credited);

      const refused = await apply(pending).expect(422);
      expect(refused.body.errors[0].code).toBe('entity_withdrawn');
      const shown = await getJsonApi(app, `/v1/works/${id}?include=contributions.identity`).expect(200);
      const identity = shown.body.included.find(({ type }: { type: string }) => type === 'identities');
      expect(identity.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
    });
  });
});
