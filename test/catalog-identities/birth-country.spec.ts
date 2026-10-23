import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveIdentity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

describe('the birth country of a person', () => {
  let app: TestApp;
  let admin: Account;
  let korea: number;
  let usa: number;

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    korea = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'Corea del Sur' }));
    usa = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'US', name: 'Estados Unidos' }));
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
  async function publishIdentity(value: object, withCreation: (entityId: string) => ChangeInput[] = () => []) {
    const entityId = await reserveIdentity(app, admin.accessToken);
    await publish([{ entityId, proposedValue: { exists: true, value } }, ...withCreation(entityId)]);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    return { entityId, publicId: revisions.body.data[0].attributes.resultKey.publicId as string };
  }

  it('is given at creation, independent of the nationalities, and included as birthCountry', async () => {
    const { publicId } = await publishIdentity({ type: 'person', displayName: 'Mark', person: { birthCountryId: usa } }, (entityId) => [
      {
        entityId,
        operation: 'add_relation',
        targetPath: 'person_nationalities',
        proposedValue: { exists: true, value: {} },
        targetKey: { person_id: { entity_id: entityId }, country_id: korea },
      },
    ]);

    const { body } = await getJsonApi(app, `/v1/identities/${publicId}?include=birthCountry`).expect(200);

    expect(body.data.attributes.person).toEqual(expect.objectContaining({ birthCountryId: usa }));
    expect(body.data.relationships.birthCountry).toEqual({ data: { type: 'countries', id: String(usa) } });
    expect(body.data.relationships.nationalities).toEqual({ data: [{ type: 'countries', id: String(korea) }] });
    expect(body.included).toEqual([expect.objectContaining({ type: 'countries', id: String(usa), attributes: { code: 'US', name: 'Estados Unidos' } })]);
  });

  it('filters identities by the code of their birth country', async () => {
    await publishIdentity({ type: 'person', displayName: 'Jennie', person: { birthCountryId: korea } });
    await publishIdentity({ type: 'person', displayName: 'Lisa', person: {} });

    const names = async (query: string) =>
      (await getJsonApi(app, `/v1/identities${query}`).expect(200)).body.data.map(({ attributes }: { attributes: { displayName: string } }) => attributes.displayName);

    expect(await names('?filter[birthCountry]=kr')).toEqual(['Jennie']);
    expect(await names('?filter[birthCountry]=US&include=birthCountry')).toEqual(['Mark']);
    expect(await names('?filter[birthCountry]=ZZ')).toEqual([]);
  });

  it('changes and removes with set_fields', async () => {
    const { entityId, publicId } = await publishIdentity({ type: 'person', displayName: 'Rosé', person: { birthCountryId: korea } });
    const birthCountry = async () => (await getJsonApi(app, `/v1/identities/${publicId}`).expect(200)).body.data.relationships.birthCountry;
    const setBirthCountry = (value: number | null): ChangeInput => ({
      entityId,
      operation: 'set_fields',
      targetPath: 'people.birth_country_id',
      proposedValue: { exists: true, value },
    });

    await publish([setBirthCountry(usa)]);
    expect(await birthCountry()).toEqual({ data: { type: 'countries', id: String(usa) } });

    await publish([setBirthCountry(null)]);
    expect(await birthCountry()).toEqual({ data: null });
  });

  it('is refused for an organization, at creation and with set_fields', async () => {
    const entityId = await reserveIdentity(app, admin.accessToken);
    const proposalId = await createDraft(app, admin.accessToken, 'Alta de YG');
    const creation = { exists: true, value: { type: 'organization', displayName: 'YG', organization: { birthCountryId: korea } } };

    const refused = await addChange(app, admin.accessToken, proposalId, { entityId, proposedValue: creation }).expect(422);
    expect(refused.body.errors[0].code).toBe('invalid_payload');

    const organization = await publishIdentity({ type: 'organization', displayName: 'YG', organization: {} });
    const response = await addChange(app, admin.accessToken, proposalId, {
      entityId: organization.entityId,
      operation: 'set_fields',
      targetPath: 'people.birth_country_id',
      proposedValue: { exists: true, value: korea },
    }).expect(422);
    expect(response.body.errors).toEqual([expect.objectContaining({ code: 'inapplicable_target', source: { pointer: '/data/attributes/targetPath' } })]);
  });

  it('refuses a country that does not exist, at creation and with set_fields', async () => {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos');
    const reserved = await reserveIdentity(app, admin.accessToken);
    const creation = { exists: true, value: { type: 'person', displayName: 'X', person: { birthCountryId: 999 } } };

    const refused = await addChange(app, admin.accessToken, proposalId, { entityId: reserved, proposedValue: creation }).expect(422);
    expect(refused.body.errors).toEqual([
      expect.objectContaining({ source: { pointer: '/data/attributes/proposedValue/value/person/birthCountryId' } }),
    ]);

    const { entityId } = await publishIdentity({ type: 'person', displayName: 'Jisoo', person: {} });
    const response = await addChange(app, admin.accessToken, proposalId, {
      entityId,
      operation: 'set_fields',
      targetPath: 'people.birth_country_id',
      proposedValue: { exists: true, value: 999 },
    }).expect(422);
    expect(response.body.errors).toEqual([expect.objectContaining({ source: { pointer: '/data/attributes/proposedValue/value' } })]);
  });
});
