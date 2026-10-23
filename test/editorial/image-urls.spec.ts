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
  submitProposal,
} from '../support/editorial';
import { TEST_IMAGE_BASE_URL, avatarUploadUrl, uploadedImageUrl } from '../support/images';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });

/**
 * The image URL rule (ADR 0005): the catalog's image fields accept null or
 * the URL of an image uploaded to the platform for the catalog.
 */
describe('image URLs of the catalog', () => {
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

  const apply = (changeId: string) => decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  const reserve = async (entityType: string): Promise<string> => (await reserveEntity(app, ana.accessToken, entityType).expect(201)).body.data.id;

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos con imagen');
    const changeIds: string[] = [];
    for (const change of changes) changeIds.push((await addChange(app, ana.accessToken, proposalId, change).expect(201)).body.data.id);
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return changeIds;
  }

  async function publish(entityType: string, targetPath: string, value: object): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve(entityType);
    const [changeId] = await submitChanges([{ entityId, operation: 'create_entity', targetPath, proposedValue: present(value) }]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  interface ImageField {
    /** The root's type, as reserved. */
    entityType: string;
    /** The `set_fields` target of the image. */
    fieldPath: string;
    /** Where the image goes in a creation's value. */
    member: string;
    /** The resource that shows the published root, and its image attribute. */
    resource: string;
    /** Dotted when nested, as `person.imgFullBody`. */
    attribute: string;
    /** A valid creation with the given image; it may publish what the root needs first. */
    creation(url: string | null): Promise<{ targetPath: string; value: object }>;
  }

  const FIELDS: ImageField[] = [
    {
      entityType: 'identity',
      fieldPath: 'catalog_identities.img_profile',
      member: 'imgProfile',
      resource: 'identities',
      attribute: 'imgProfile',
      creation: async (url) => ({ targetPath: 'catalog_identities', value: personCreation({ imgProfile: url }).value }),
    },
    {
      entityType: 'identity',
      fieldPath: 'people.img_full_body',
      member: 'person/imgFullBody',
      resource: 'identities',
      attribute: 'person.imgFullBody',
      creation: async (url) => ({ targetPath: 'catalog_identities', value: { type: 'person', displayName: 'IU', person: { imgFullBody: url } } }),
    },
    {
      entityType: 'release',
      fieldPath: 'releases.cover_art_url',
      member: 'coverArtUrl',
      resource: 'releases',
      attribute: 'coverArtUrl',
      creation: async (url) => {
        const group = await publish('release_group', 'release_groups', { title: 'BE', type: 'album' });
        return { targetPath: 'releases', value: { releaseGroup: { entity_id: group.entityId }, coverArtUrl: url } };
      },
    },
    {
      entityType: 'tour',
      fieldPath: 'tours.image_url',
      member: 'imageUrl',
      resource: 'tours',
      attribute: 'imageUrl',
      creation: async (url) => ({ targetPath: 'tours', value: { title: 'BORN PINK World Tour', status: 'announced', imageUrl: url } }),
    },
    {
      entityType: 'event',
      fieldPath: 'events.image_url',
      member: 'imageUrl',
      resource: 'events',
      attribute: 'imageUrl',
      creation: async (url) => ({ targetPath: 'events', value: { title: 'BORN PINK in Seoul', status: 'announced', imageUrl: url } }),
    },
  ];

  /** The URLs the rule refuses, each with a name for the test. */
  const refusedUrls = async (): Promise<Array<[string, string]>> => [
    ['an external URL', 'https://example.com/iu.png'],
    ['a URL under the base that was never uploaded', `${TEST_IMAGE_BASE_URL}00000000-0000-4000-8000-000000000000.png`],
    ['an upload made as an avatar', await avatarUploadUrl(app, ana)],
  ];

  /** The 422 errors of adding a change to a fresh draft. */
  async function refusal(change: ChangeInput) {
    const proposalId = await createDraft(app, ana.accessToken);
    const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(422);
    return body.errors.map(({ code, source }: { code: string; source: { pointer: string } }) => ({ code, pointer: source.pointer }));
  }

  describe.each(FIELDS)('$fieldPath', (field) => {
    async function creationChange(url: string | null): Promise<ChangeInput> {
      const entityId = await reserve(field.entityType);
      const { targetPath, value } = await field.creation(url);
      return { entityId, operation: 'create_entity', targetPath, proposedValue: present(value) };
    }

    async function publishWithoutImage(): Promise<{ entityId: string; id: string }> {
      const { targetPath, value } = await field.creation(null);
      return publish(field.entityType, targetPath, value);
    }

    const fieldChange = (entityId: string, value: unknown): ChangeInput => ({
      entityId,
      operation: 'set_fields',
      targetPath: field.fieldPath,
      proposedValue: present(value),
    });

    async function shown(id: string): Promise<unknown> {
      const { body } = await getJsonApi(app, `/v1/${field.resource}/${id}`).expect(200);
      return field.attribute.split('.').reduce((attributes, name) => attributes[name], body.data.attributes);
    }

    it('refuses, in a creation, a URL that is not a catalog upload', async () => {
      for (const [, url] of await refusedUrls()) {
        expect(await refusal(await creationChange(url))).toEqual([
          { code: 'unknown_catalog_image', pointer: `/data/attributes/proposedValue/value/${field.member}` },
        ]);
      }
    });

    it('refuses, in set_fields, a URL that is not a catalog upload', async () => {
      const { entityId } = await publishWithoutImage();
      for (const [, url] of await refusedUrls()) {
        expect(await refusal(fieldChange(entityId, url))).toEqual([{ code: 'unknown_catalog_image', pointer: '/data/attributes/proposedValue/value' }]);
      }
    });

    it('publishes a creation with a catalog upload, and with null', async () => {
      const url = await uploadedImageUrl(app, ana.accessToken);
      const [withImage] = await submitChanges([await creationChange(url)]);
      const [withoutImage] = await submitChanges([await creationChange(null)]);

      const published = (await apply(withImage).expect(201)).body.included[0].attributes.resultKey.publicId;
      await apply(withoutImage).expect(201);
      expect(await shown(published)).toBe(url);
    });

    it('sets and removes the image with set_fields', async () => {
      const { entityId, id } = await publishWithoutImage();
      const url = await uploadedImageUrl(app, ana.accessToken);

      await apply((await submitChanges([fieldChange(entityId, url)]))[0]).expect(201);
      expect(await shown(id)).toBe(url);
      await apply((await submitChanges([fieldChange(entityId, null)]))[0]).expect(201);
      expect(await shown(id)).toBeNull();
    });
  });

  describe('when the configured base changes', () => {
    const NEW_BASE = 'https://img.example.com/';
    let moved: TestApp;

    beforeAll(async () => {
      // Another instance on the same database, configured with another base.
      moved = await createTestApp({ env: { IMAGE_PUBLIC_BASE_URL: NEW_BASE } });
    });

    afterAll(async () => {
      await moved.close();
    });

    it('still applies a microchange submitted under the old base: the rule is checked when writing and submitting', async () => {
      const url = await uploadedImageUrl(app, ana.accessToken);
      const entityId = await reserve('identity');
      const [changeId] = await submitChanges([
        { entityId, operation: 'create_entity', targetPath: 'catalog_identities', proposedValue: personCreation({ imgProfile: url }) },
      ]);

      const response = await decideChange(moved, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision').expect(201);
      const { body } = await getJsonApi(moved, `/v1/identities/${response.body.included[0].attributes.resultKey.publicId}`).expect(200);
      expect(body.data.attributes.imgProfile).toBe(url);
    });

    it('refuses to submit a draft whose image is no longer under the base', async () => {
      const url = await uploadedImageUrl(app, ana.accessToken);
      const entityId = await reserve('identity');
      const proposalId = await createDraft(app, ana.accessToken, 'Alta con imagen');
      const change = { entityId, operation: 'create_entity', targetPath: 'catalog_identities', proposedValue: personCreation({ imgProfile: url }) };
      const { body: added } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);

      const { body } = await submitProposal(moved, ana.accessToken, proposalId).expect(422);
      expect(body.errors).toEqual([
        expect.objectContaining({ code: 'unknown_catalog_image', meta: { changeId: added.data.id, member: 'proposedValue/value/imgProfile' } }),
      ]);
    });
  });
});
