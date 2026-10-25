import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveIdentity } from '../support/editorial';
import { uploadedImageUrl } from '../support/images';
import { TestApp, createTestApp } from '../support/test-app';

/** The full-body image of a person: optional, independent of the height. The image URL rule is in image-urls.spec.ts. */
describe('the full-body image of a person', () => {
  let app: TestApp;
  let admin: Account;

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Publishes the given microchanges directly, as staff may (E18). */
  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  /** Publishes an identity and returns its editorial root and public id. */
  async function publishIdentity(value: object) {
    const entityId = await reserveIdentity(app, admin.accessToken);
    await publish([{ entityId, proposedValue: { exists: true, value } }]);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    return { entityId, publicId: revisions.body.data[0].attributes.resultKey.publicId as string };
  }

  const attributes = async (publicId: string) => (await getJsonApi(app, `/v1/identities/${publicId}`).expect(200)).body.data.attributes;

  it('is given at creation without a height, and shown as imgFullBody of the person', async () => {
    const url = await uploadedImageUrl(app, admin.accessToken);
    const { publicId } = await publishIdentity({ type: 'person', displayName: 'Jisoo', person: { imgFullBody: url } });

    expect((await attributes(publicId)).person).toEqual(expect.objectContaining({ imgFullBody: { url, width: 8, height: 8 }, heightCm: null }));
  });

  it('is null by default', async () => {
    const { publicId } = await publishIdentity({ type: 'person', displayName: 'Jennie', person: {} });

    expect((await attributes(publicId)).person).toEqual(expect.objectContaining({ imgFullBody: null }));
  });

  it('changes and removes with set_fields, without a height', async () => {
    const { entityId, publicId } = await publishIdentity({ type: 'person', displayName: 'Rosé', person: {} });
    const setImage = (value: string | null): ChangeInput => ({
      entityId,
      operation: 'set_fields',
      targetPath: 'people.img_full_body',
      proposedValue: { exists: true, value },
    });
    const url = await uploadedImageUrl(app, admin.accessToken);

    await publish([setImage(url)]);
    expect((await attributes(publicId)).person).toEqual(expect.objectContaining({ imgFullBody: { url, width: 8, height: 8 }, heightCm: null }));

    await publish([setImage(null)]);
    expect((await attributes(publicId)).person.imgFullBody).toBeNull();
  });

  it('is refused for an organization, at creation and with set_fields', async () => {
    const url = await uploadedImageUrl(app, admin.accessToken);
    const entityId = await reserveIdentity(app, admin.accessToken);
    const proposalId = await createDraft(app, admin.accessToken, 'Alta de YG');
    const creation = { exists: true, value: { type: 'organization', displayName: 'YG', organization: { imgFullBody: url } } };

    const refused = await addChange(app, admin.accessToken, proposalId, { entityId, proposedValue: creation }).expect(422);
    expect(refused.body.errors[0].code).toBe('invalid_payload');

    const organization = await publishIdentity({ type: 'organization', displayName: 'YG', organization: {} });
    const response = await addChange(app, admin.accessToken, proposalId, {
      entityId: organization.entityId,
      operation: 'set_fields',
      targetPath: 'people.img_full_body',
      proposedValue: { exists: true, value: url },
    }).expect(422);
    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'inapplicable_target', source: { pointer: '/data/attributes/targetPath' } })]);
  });
});
