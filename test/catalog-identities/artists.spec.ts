import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveIdentity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const MINUTE = 60 * 1000;

describe('artists (C6, C7) and memberships (C3)', () => {
  let app: TestApp;
  let admin: Account;
  /** Public ids and editorial roots by display name. */
  const identities: Record<string, string> = {};
  const roots: Record<string, string> = {};
  let vocalist: number;

  /** Publishes the given microchanges directly, as staff may (E18). */
  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  const add = (entityId: string, targetPath: string, value: object, targetKey?: object): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath,
    proposedValue: { exists: true, value },
    ...(targetKey ? { targetKey } : {}),
  });

  const artist = (entityId: string) => add(entityId, 'artists', {}, { catalog_identity_id: { entity_id: entityId } });

  /** Publishes an identity, with an artist profile unless told otherwise. */
  async function publishIdentity(displayName: string, type: 'person' | 'organization', withArtist = true): Promise<string> {
    const entityId = await reserveIdentity(app, admin.accessToken);
    const subtype = type === 'person' ? { person: {} } : { organization: {} };
    await publish([{ entityId, proposedValue: { exists: true, value: { type, displayName, ...subtype } } }, ...(withArtist ? [artist(entityId)] : [])]);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    identities[displayName] = revisions.body.data[0].attributes.resultKey.publicId;
    roots[displayName] = entityId;
    app.clock.advance(MINUTE);
    return entityId;
  }

  const affiliation = (organization: string, startedAt: string, endedAt: string | null) => ({
    organization: { entity_id: organization },
    relationshipType: 'agency',
    startedAt,
    endedAt,
    status: endedAt ? 'former' : 'current',
    description: null,
  });

  const membership = (member: string, joined: object, roles: object[] = []) => ({
    member: { entity_id: member },
    joined,
    left: null,
    status: 'current',
    description: null,
    sourceText: null,
    sourceUrl: null,
    roles,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    vocalist = Number(
      await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug: 'vocalist', name: 'Vocalista', category: 'performance', scopes: ['membership'] }),
    );

    const edam = await publishIdentity('EDAM Entertainment', 'organization', false);
    const yg = await publishIdentity('YG Entertainment', 'organization', false);
    const iu = await publishIdentity('IU', 'person');
    await publish([
      add(iu, 'catalog_identity_aliases', { alias: 'Lee Ji-eun', isPrimary: true, sortOrder: 0 }),
      add(iu, 'artist_organization_affiliations', affiliation(edam, '2008-09-18', null)),
    ]);
    const blackpink = await publishIdentity('BLACKPINK', 'organization');
    await publish([add(blackpink, 'artist_organization_affiliations', affiliation(yg, '2016-08-08', '2023-12-31'))]);
    const jisoo = await publishIdentity('Jisoo', 'person');
    await publish([add(jisoo, 'artist_organization_affiliations', affiliation(yg, '2016-08-08', '2023-12-31'))]);
    const lisa = await publishIdentity('Lisa', 'person');
    const retired = await publishIdentity('Retirada', 'person');
    await publish([
      add(blackpink, 'organization_memberships', membership(jisoo, { year: 2016, month: 8, day: 8 }, [{ contributionRoleId: vocalist, position: 0, details: null }])),
      add(blackpink, 'organization_memberships', membership(lisa, { year: 2016, month: 8, day: 8 })),
      add(blackpink, 'organization_memberships', membership(retired, { year: 2015 })),
    ]);
    await publish([{ entityId: retired, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } }]);
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => getJsonApi(app, path);
  /** The display names of the identities of the listed artists, which `include=identity` brings. */
  const names = (body: { data: { relationships: { identity: { data: { id: string } } } }[]; included: { id: string; attributes: { displayName: string } }[] }) =>
    body.data.map(({ relationships }) => body.included.find(({ id }) => id === relationships.identity.data.id)!.attributes.displayName);
  const artists = (query: string) => get(`/v1/artists?include=identity${query}`);

  describe('GET /v1/artists', () => {
    it('lists the published artists by display name, without those of withdrawn identities', async () => {
      const { body } = await artists('&page[size]=2').expect(200);

      expect(names(body)).toEqual(['BLACKPINK', 'IU']);
      expect(body.meta).toEqual({ total: 4 });
      expect(body.data[1]).toEqual(
        expect.objectContaining({
          type: 'artists',
          attributes: expect.objectContaining({ publicationStatus: 'published', withdrawnAt: null }),
          relationships: {
            identity: { data: { type: 'identities', id: identities.IU } },
            affiliations: { data: [{ type: 'artist-affiliations', id: expect.any(String) }] },
          },
          meta: { editorialEntityId: roots.IU },
        }),
      );
    });

    it('sorts by newest first', async () => {
      const { body } = await artists('&sort=-createdAt').expect(200);

      expect(names(body)).toEqual(['Lisa', 'Jisoo', 'BLACKPINK', 'IU']);
    });

    it('filters by name or alias, identity type, affiliated organization and affiliation status', async () => {
      expect(names((await artists('&filter[q]=lee')).body)).toEqual(['IU']);
      expect(names((await artists('&filter[identityType]=organization')).body)).toEqual(['BLACKPINK']);
      expect(names((await artists(`&filter[affiliatedWith]=${identities['EDAM Entertainment']}`)).body)).toEqual(['IU']);
      expect(names((await artists(`&filter[affiliatedWith]=${identities['YG Entertainment']}&filter[affiliationStatus]=former`)).body)).toEqual([
        'BLACKPINK',
        'Jisoo',
      ]);
      expect(names((await artists(`&filter[affiliatedWith]=${identities['YG Entertainment']}&filter[affiliationStatus]=current`)).body)).toEqual([]);
      expect(names((await artists('&filter[affiliationStatus]=current')).body)).toEqual(['IU']);
    });

    it('rejects an unknown filter value, sort or include', async () => {
      await artists('&filter[identityType]=band').expect(400);
      await artists('&filter[affiliationStatus]=past').expect(400);
      await artists('&sort=name').expect(400);
      await get('/v1/artists?include=memberships').expect(400);
    });

    it('includes the identity with its aliases and the affiliations with their organizations', async () => {
      const { body } = await get('/v1/artists?filter[q]=IU&include=identity.aliases,affiliations.organization').expect(200);

      const types = body.included.map(({ type, attributes }: { type: string; attributes: { displayName?: string } }) => `${type}:${attributes.displayName ?? ''}`);
      expect(types.sort()).toEqual(['artist-affiliations:', 'identities:EDAM Entertainment', 'identities:IU', 'identity-aliases:'].sort());
      const affiliation = body.included.find(({ type }: { type: string }) => type === 'artist-affiliations');
      expect(affiliation.attributes).toEqual(
        expect.objectContaining({ relationshipType: 'agency', startedAt: '2008-09-18', endedAt: null, status: 'current' }),
      );
    });
  });

  describe('GET /v1/artists/{id}', () => {
    async function artistIdOf(name: string): Promise<string> {
      const { body } = await get(`/v1/identities/${identities[name]}`).expect(200);
      return body.data.relationships.artist.data.id;
    }

    it('shows an artist with its identity', async () => {
      const id = await artistIdOf('IU');

      const { body } = await get(`/v1/artists/${id}?include=identity`).expect(200);

      expect(body.data).toEqual(expect.objectContaining({ type: 'artists', id, meta: { editorialEntityId: roots.IU } }));
      expect(body.included[0]).toEqual(expect.objectContaining({ type: 'identities', id: identities.IU }));
    });

    it('answers 404 for an unknown artist', async () => {
      await get('/v1/artists/desconocido').expect(404);
    });

    it('shows only the notice of the artist of a withdrawn identity', async () => {
      const { body: identity } = await get(`/v1/identities/${identities.Retirada}`).expect(200);
      expect(identity.data.relationships).toBeUndefined();
      const { body: list } = await get(`/v1/identities/${identities.BLACKPINK}/memberships?include=member`).expect(200);
      const retired = list.included.find(({ id }: { id: string }) => id === identities.Retirada);
      expect(retired.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
    });
  });

  describe('GET /v1/identities/{id}/memberships', () => {
    const memberships = (name: string, query = '') => get(`/v1/identities/${identities[name]}/memberships${query}`);

    it('lists the members of an organization with their roles', async () => {
      const { body } = await memberships('BLACKPINK', '?filter[side]=organization&include=member,roles.role').expect(200);

      expect(body.meta).toEqual({ total: 3 });
      expect(body.data[0]).toEqual(
        expect.objectContaining({
          type: 'organization-memberships',
          attributes: expect.objectContaining({ joined: { year: 2015, month: null, day: null }, left: null, status: 'current' }),
          relationships: expect.objectContaining({
            organization: { data: { type: 'identities', id: identities.BLACKPINK } },
            member: { data: { type: 'identities', id: identities.Retirada } },
          }),
        }),
      );
      const jisoo = body.data.find(({ relationships }: { relationships: { member: { data: { id: string } } } }) => relationships.member.data.id === identities.Jisoo);
      expect(jisoo.relationships.roles.data).toHaveLength(1);
      const role = body.included.find(({ type }: { type: string }) => type === 'membership-roles');
      expect(role.relationships.role.data).toEqual({ type: 'contribution-roles', id: String(vocalist) });
      expect(body.included.some(({ type, id }: { type: string; id: string }) => type === 'contribution-roles' && id === String(vocalist))).toBe(true);
    });

    it('lists the memberships of a member, and both sides by default', async () => {
      const { body } = await memberships('Jisoo', '?filter[side]=member').expect(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].relationships.organization.data.id).toBe(identities.BLACKPINK);

      expect((await memberships('Jisoo').expect(200)).body.meta.total).toBe(1);
      expect((await memberships('BLACKPINK', '?filter[side]=member').expect(200)).body.meta.total).toBe(0);
    });

    it('rejects an unknown side and answers 404 for an unknown identity', async () => {
      await memberships('BLACKPINK', '?filter[side]=both').expect(400);
      await get('/v1/identities/desconocida/memberships').expect(404);
    });
  });

  describe('identities with artist profiles (C1)', () => {
    it('filters identities by whether they have an artist profile', async () => {
      const { body: withProfile } = await get('/v1/identities?filter[hasArtistProfile]=true').expect(200);
      expect(withProfile.data.map(({ attributes }: { attributes: { displayName: string } }) => attributes.displayName)).toEqual([
        'BLACKPINK',
        'IU',
        'Jisoo',
        'Lisa',
      ]);
      const { body: without } = await get('/v1/identities?filter[hasArtistProfile]=false').expect(200);
      expect(without.meta.total).toBe(2);
    });
  });
});
