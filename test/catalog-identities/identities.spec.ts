import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveIdentity } from '../support/editorial';
import { uploadedPlatformIconUrl } from '../support/images';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const MINUTE = 60 * 1000;

describe('GET /v1/identities (C1) and /v1/identities/{id} (C2)', () => {
  let app: TestApp;
  let admin: Account;
  /** Public ids by display name. */
  const identities: Record<string, string> = {};
  const roots: Record<string, string> = {};
  let korea: number;
  let agency: number;
  let label: number;
  let spotify: number;

  /** Publishes the given microchanges directly, as staff may (E18). */
  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  /** Publishes an identity with the relations its creation can carry, and then the rest. */
  async function publishIdentity(
    value: { type: string; displayName: string; person?: object; organization?: object },
    relations: (entityId: string) => { withCreation?: ChangeInput[]; later?: ChangeInput[] } = () => ({}),
  ): Promise<void> {
    const entityId = await reserveIdentity(app, admin.accessToken);
    const { withCreation = [], later = [] } = relations(entityId);
    await publish([{ entityId, proposedValue: { exists: true, value } }, ...withCreation]);
    if (later.length > 0) await publish(later);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    identities[value.displayName] = revisions.body.data[0].attributes.resultKey.publicId;
    roots[value.displayName] = entityId;
    app.clock.advance(MINUTE);
  }

  const relation = (entityId: string, targetPath: string, value: object | null, targetKey?: object): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath,
    proposedValue: { exists: true, value: value ?? {} },
    ...(targetKey ? { targetKey } : {}),
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    korea = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'South Korea' }));
    const japan = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'JP', name: 'Japan' }));
    agency = Number(await createdEntryId(app, admin.accessToken, 'organization-types', { slug: 'agency', name: 'Agencia' }));
    label = Number(await createdEntryId(app, admin.accessToken, 'organization-types', { slug: 'label', name: 'Sello' }));
    spotify = Number(
      await createdEntryId(app, admin.accessToken, 'platforms', {
        name: 'Spotify',
        slug: 'spotify',
        iconUrl: await uploadedPlatformIconUrl(app, admin.accessToken),
        supportsCatalogIdentity: true,
      }),
    );

    await publishIdentity({ type: 'person', displayName: 'IU', person: { birthDate: '1993-05-16' } }, (entityId) => ({
      withCreation: [relation(entityId, 'person_nationalities', null, { person_id: { entity_id: entityId }, country_id: korea })],
      later: [
        relation(entityId, 'catalog_identity_aliases', { alias: 'Lee Ji-eun', isPrimary: true, sortOrder: 0 }),
        relation(entityId, 'catalog_identity_platform_links', { platformId: spotify, url: 'https://open.spotify.com/artist/iu' }),
      ],
    }));
    await publishIdentity({ type: 'organization', displayName: 'EDAM Entertainment', organization: { founding: { year: 2015 }, originCountryId: korea } }, (entityId) => ({
      withCreation: [relation(entityId, 'organization_type_assignments', null, { organization_id: { entity_id: entityId }, organization_type_id: agency })],
    }));
    await publishIdentity({ type: 'organization', displayName: 'Ámbar Records', organization: { originCountryId: japan } }, (entityId) => ({
      withCreation: [relation(entityId, 'organization_type_assignments', null, { organization_id: { entity_id: entityId }, organization_type_id: label })],
    }));
    await publishIdentity({ type: 'person', displayName: 'Yoon Sang', person: {} });
    // A reservation is never listed.
    await reserveIdentity(app, admin.accessToken);
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (query = '') => getJsonApi(app, `/v1/identities${query}`);
  const names = (body: { data: { attributes: { displayName: string } }[] }) => body.data.map(({ attributes }) => attributes.displayName);

  it('lists published identities by display name, with pagination', async () => {
    const { body } = await list('?page[size]=3').expect(200);

    expect(names(body)).toEqual(['Ámbar Records', 'EDAM Entertainment', 'IU']);
    expect(body.meta).toEqual({ total: 4 });
    expect(body.links.next).toContain('page%5Bnumber%5D=2');
    expect(body.data[2]).toEqual(
      expect.objectContaining({
        type: 'identities',
        id: identities.IU,
        meta: { editorialEntityId: roots.IU },
        relationships: expect.objectContaining({
          aliases: { data: [{ type: 'identity-aliases', id: expect.any(String) }] },
          nationalities: { data: [{ type: 'countries', id: String(korea) }] },
          originCountry: { data: null },
          organizationTypes: { data: [] },
          platformLinks: { data: [{ type: 'identity-platform-links', id: expect.any(String) }] },
          artist: { data: null },
        }),
      }),
    );
  });

  it('sorts by newest first', async () => {
    const { body } = await list('?sort=-createdAt').expect(200);

    expect(names(body)).toEqual(['Yoon Sang', 'Ámbar Records', 'EDAM Entertainment', 'IU']);
  });

  it('searches display names and aliases, ignoring case and accents', async () => {
    expect(names((await list('?filter[q]=ambar').expect(200)).body)).toEqual(['Ámbar Records']);
    expect(names((await list('?filter[q]=JI-EUN').expect(200)).body)).toEqual(['IU']);
  });

  it('filters by type, nationality, origin country and organization type', async () => {
    expect(names((await list('?filter[type]=person').expect(200)).body)).toEqual(['IU', 'Yoon Sang']);
    expect(names((await list('?filter[nationality]=kr').expect(200)).body)).toEqual(['IU']);
    expect(names((await list('?filter[originCountry]=KR').expect(200)).body)).toEqual(['EDAM Entertainment']);
    expect(names((await list('?filter[organizationType]=label').expect(200)).body)).toEqual(['Ámbar Records']);
    expect(names((await list('?filter[type]=organization&filter[originCountry]=JP').expect(200)).body)).toEqual(['Ámbar Records']);
  });

  it('filters by artist profile, which no identity has until artists exist', async () => {
    expect((await list('?filter[hasArtistProfile]=true').expect(200)).body.meta.total).toBe(0);
    expect((await list('?filter[hasArtistProfile]=false').expect(200)).body.meta.total).toBe(4);
  });

  it('includes the related resources of the matrix', async () => {
    const { body } = await list('?filter[q]=IU&include=aliases,nationalities,platformLinks.platform,artist').expect(200);

    expect(body.included).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'identity-aliases', attributes: { alias: 'Lee Ji-eun', isPrimary: true, sortOrder: 0 } }),
        expect.objectContaining({ type: 'countries', id: String(korea), attributes: { code: 'KR', name: 'South Korea' } }),
        expect.objectContaining({
          type: 'identity-platform-links',
          attributes: expect.objectContaining({ url: 'https://open.spotify.com/artist/iu' }),
          relationships: { platform: { data: { type: 'platforms', id: String(spotify) } } },
        }),
        expect.objectContaining({ type: 'platforms', id: String(spotify) }),
      ]),
    );
    expect(body.included).toHaveLength(4);
  });

  it('shows an identity with its organization types and origin country (C2)', async () => {
    const { body } = await getJsonApi(app, `/v1/identities/${identities['EDAM Entertainment']}?include=organizationTypes,originCountry`).expect(200);

    expect(body.data.attributes.organization).toEqual(
      expect.objectContaining({ founding: { year: 2015, month: null, day: null }, originCountryId: korea }),
    );
    expect(body.data.relationships.organizationTypes).toEqual({ data: [{ type: 'organization-types', id: String(agency) }] });
    expect(body.included).toEqual([
      expect.objectContaining({ type: 'organization-types', id: String(agency) }),
      expect.objectContaining({ type: 'countries', id: String(korea) }),
    ]);
  });

  it('rejects filters, values, sorts and includes outside the matrix', async () => {
    await list('?filter[bio]=x').expect(400);
    await list('?filter[type]=band').expect(400);
    await list('?filter[hasArtistProfile]=yes').expect(400);
    await list('?sort=bio').expect(400);
    await list('?include=aliases.identity').expect(400);
  });

  describe('once an identity is withdrawn', () => {
    beforeAll(async () => {
      await publish([
        { entityId: roots.IU, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } },
      ]);
    });

    it('leaves it out of the list', async () => {
      expect(names((await list().expect(200)).body)).toEqual(['Ámbar Records', 'EDAM Entertainment', 'Yoon Sang']);
      expect((await list('?filter[q]=ji-eun').expect(200)).body.meta.total).toBe(0);
    });

    it('shows only its notice, without its relations', async () => {
      const { body } = await getJsonApi(app, `/v1/identities/${identities.IU}?include=aliases,platformLinks`).expect(200);

      expect(body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect(body.data.relationships).toBeUndefined();
      expect(body.included).toEqual([]);
    });
  });
});
