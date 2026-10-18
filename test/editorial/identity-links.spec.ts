import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import {
  ChangeInput,
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
import { createdEntryId } from '../support/vocabularies';

const ORGANIZATION_TYPES = 'organization_type_assignments';
const PLATFORM_LINKS = 'catalog_identity_platform_links';

describe('organization types and platform links of identities', () => {
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

  async function submitChanges(changes: ChangeInput[]): Promise<{ proposalId: string; changeIds: string[] }> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos de EDAM');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return { proposalId, changeIds };
  }

  /** The public id of each identity the test published, by editorial root. */
  const publicIds = new Map<string, string>();
  const publicIdOf = (entityId: string) => publicIds.get(entityId)!;

  async function applyCreation(entityId: string, changeId: string): Promise<string> {
    const response = await apply(changeId).expect(201);
    publicIds.set(entityId, response.body.included[0].attributes.resultKey.publicId);
    return entityId;
  }

  /** Publishes an identity through its creation and returns its editorial root. */
  async function publish(proposedValue: object): Promise<string> {
    const entityId = await reserveIdentity(app, ana.accessToken);
    const { changeIds } = await submitChanges([{ entityId, proposedValue }]);
    return applyCreation(entityId, changeIds[0]);
  }

  const publishOrganization = () =>
    publish({ exists: true, value: { type: 'organization', displayName: 'EDAM Entertainment', organization: { founding: { year: 2015 } } } });

  async function publishPerson(): Promise<string> {
    const { entityId, changeId } = await submitIdentityCreation(app, ana.accessToken);
    return applyCreation(entityId, changeId);
  }

  const organizationType = (entityId: string, organizationTypeId: number, operation = 'add_relation'): ChangeInput => ({
    entityId,
    operation,
    targetPath: ORGANIZATION_TYPES,
    targetKey: { organization_id: { entity_id: entityId }, organization_type_id: organizationTypeId },
    proposedValue: operation === 'add_relation' ? { exists: true, value: {} } : { exists: false },
  });

  describe('organization types', () => {
    let agency: number;

    beforeEach(async () => {
      agency = Number(await createdEntryId(app, admin.accessToken, 'organization-types', { slug: 'agency', name: 'Agencia' }));
    });

    it('assigns a type to an organization and removes it', async () => {
      const entityId = await publishOrganization();

      const added = await submitChanges([organizationType(entityId, agency)]);
      const addition = await apply(added.changeIds[0]).expect(201);
      expect(addition.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: false }, afterValue: { exists: true, value: {} } }),
      );

      const removed = await submitChanges([organizationType(entityId, agency, 'remove_relation')]);
      const removal = await apply(removed.changeIds[0]).expect(201);
      expect(removal.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: true, value: {} }, afterValue: { exists: false } }),
      );
    });

    it('assigns a type within the creation of the organization', async () => {
      const entityId = await reserveIdentity(app, ana.accessToken);
      const creation = { exists: true, value: { type: 'organization', displayName: 'EDAM Entertainment', organization: {} } };
      const { changeIds } = await submitChanges([{ entityId, proposedValue: creation }, organizationType(entityId, agency)]);

      await apply(changeIds[0]).expect(201);
      const response = await apply(changeIds[1]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('applied');
    });

    it('rejects a type that does not exist and an identity that is not an organization', async () => {
      const organization = await publishOrganization();
      const person = await publishPerson();
      const proposalId = await createDraft(app, ana.accessToken);

      const unknown = await addChange(app, ana.accessToken, proposalId, organizationType(organization, agency + 100)).expect(422);
      expect(unknown.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'unknown_vocabulary_entry', source: { pointer: '/data/attributes/targetKey/organization_type_id' } }),
      );
      const inapplicable = await addChange(app, ana.accessToken, proposalId, organizationType(person, agency)).expect(422);
      expect(inapplicable.body.errors[0].code).toBe('inapplicable_target');
    });
  });

  describe('platform links', () => {
    const SPOTIFY_URL = 'https://open.spotify.com/artist/3HqSLMAZ3g3d5poNaI7GOU';
    let spotify: number;
    let melon: number;

    beforeEach(async () => {
      const platform = (slug: string, supportsCatalogIdentity: boolean) =>
        createdEntryId(app, admin.accessToken, 'platforms', {
          name: slug,
          slug,
          iconUrl: `https://cdn.example.com/${slug}.svg`,
          supportsCatalogIdentity,
          supportsTrack: true,
        });
      spotify = Number(await platform('spotify', true));
      melon = Number(await platform('melon', false));
    });

    const addLink = (entityId: string, value: object): ChangeInput => ({
      entityId,
      operation: 'add_relation',
      targetPath: PLATFORM_LINKS,
      proposedValue: { exists: true, value },
    });

    it('adds, updates and removes a link, keeping its generated key', async () => {
      const entityId = await publishPerson();

      const added = await submitChanges([addLink(entityId, { platformId: spotify, url: SPOTIFY_URL })]);
      const addition = await apply(added.changeIds[0]).expect(201);
      const { resultKey, afterValue } = addition.body.included[0].attributes;
      expect(afterValue).toEqual({ exists: true, value: { platformId: spotify, url: SPOTIFY_URL } });
      expect(resultKey).toEqual({ id: expect.any(Number) });

      const newUrl = 'https://open.spotify.com/artist/iu';
      const updated = await submitChanges([
        {
          entityId,
          operation: 'update_relation',
          targetPath: PLATFORM_LINKS,
          targetKey: resultKey,
          proposedValue: { exists: true, value: { platformId: spotify, url: newUrl } },
        },
      ]);
      const update = await apply(updated.changeIds[0]).expect(201);
      expect(update.body.included[0].attributes.afterValue).toEqual({ exists: true, value: { platformId: spotify, url: newUrl } });

      const removed = await submitChanges([
        { entityId, operation: 'remove_relation', targetPath: PLATFORM_LINKS, targetKey: resultKey, proposedValue: { exists: false } },
      ]);
      const removal = await apply(removed.changeIds[0]).expect(201);
      expect(removal.body.included[0].attributes).toEqual(
        expect.objectContaining({ beforeValue: { exists: true, value: { platformId: spotify, url: newUrl } }, afterValue: { exists: false } }),
      );
    });

    it('accepts a link only on an HTTP(S) URL, without a play count', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, ana.accessToken);

      const ftp = await addChange(app, ana.accessToken, proposalId, addLink(entityId, { platformId: spotify, url: 'ftp://spotify.com/iu' })).expect(422);
      expect(ftp.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/url' });
      const counted = await addChange(
        app,
        ana.accessToken,
        proposalId,
        addLink(entityId, { platformId: spotify, url: SPOTIFY_URL, playCount: 1000 }),
      ).expect(422);
      expect(counted.body.errors[0].source).toEqual({ pointer: '/data/attributes/proposedValue/value/playCount' });
    });

    it('accepts a link only on a platform that supports identities', async () => {
      const entityId = await publishPerson();
      const proposalId = await createDraft(app, ana.accessToken);

      const response = await addChange(app, ana.accessToken, proposalId, addLink(entityId, { platformId: melon, url: 'https://www.melon.com/iu' })).expect(422);

      expect(response.body.errors[0]).toEqual(
        expect.objectContaining({ code: 'unsupported_platform', source: { pointer: '/data/attributes/proposedValue/value/platformId' } }),
      );
    });

    it('takes a second insertion of the same link as satisfied, without a second row', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges([addLink(entityId, { platformId: spotify, url: SPOTIFY_URL })]);
      const second = await submitChanges([addLink(entityId, { platformId: spotify, url: SPOTIFY_URL })]);
      await apply(first.changeIds[0]).expect(201);

      const response = await apply(second.changeIds[0]).expect(201);

      expect(response.body.data[0].attributes.resultingStatus).toBe('satisfied');
      const { body } = await getJsonApi(app, `/v1/identities/${await publicIdOf(entityId)}?include=platformLinks`).expect(200);
      expect(body.data.relationships.platformLinks.data).toHaveLength(1);
    });

    it('never updates a link onto the platform and URL of another one', async () => {
      const entityId = await publishPerson();
      const otherUrl = 'https://open.spotify.com/artist/iu';
      const { changeIds } = await submitChanges([
        addLink(entityId, { platformId: spotify, url: SPOTIFY_URL }),
        addLink(entityId, { platformId: spotify, url: otherUrl }),
      ]);
      await apply(changeIds[0]).expect(201);
      const other = (await apply(changeIds[1]).expect(201)).body.included[0].attributes.resultKey;
      const moved = await submitChanges([
        {
          entityId,
          operation: 'update_relation',
          targetPath: PLATFORM_LINKS,
          targetKey: other,
          proposedValue: { exists: true, value: { platformId: spotify, url: SPOTIFY_URL } },
        },
      ]);

      const conflict = await apply(moved.changeIds[0]).expect(409);
      expect(conflict.body.errors[0].code).toBe('base_changed');
      const rebased = await decideChange(app, moderator.accessToken, moved.changeIds[0], {
        action: 'apply_rebased',
        confirmedVersion: 3,
        reason: 'Mismo enlace',
      }).expect(409);
      expect(rebased.body.errors[0].code).toBe('constraint_violated');
    });

    it('lets two different links of the same platform apply from the same base', async () => {
      const entityId = await publishPerson();
      const first = await submitChanges([addLink(entityId, { platformId: spotify, url: SPOTIFY_URL })]);
      const second = await submitChanges([addLink(entityId, { platformId: spotify, url: 'https://open.spotify.com/artist/iu' })]);

      await apply(first.changeIds[0]).expect(201);
      await apply(second.changeIds[0]).expect(201);
    });
  });

});
