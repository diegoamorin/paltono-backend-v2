import { DataSource } from 'typeorm';
import { sendJsonApi } from '../support/accounts';
import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { fetchImage, fileRemovedAt, uploadedAvatarUrl, uploadedImageUrl, uploadedPlatformIconUrl } from '../support/images';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';
import {
  createEntry,
  createVocabularyReferencesTable,
  createdEntryId,
  deleteEntry,
  dropVocabularyReferencesTable,
  getPublic,
  referenceEntry,
  updateEntry,
} from '../support/vocabularies';

interface VocabularyCase {
  type: string;
  /** Attributes of a valid new entry, as sent. */
  create: Record<string, unknown>;
  /** The attributes the created entry has. */
  created: Record<string, unknown>;
  /** A partial update and the attributes it changes. */
  update: Record<string, unknown>;
  updated: Record<string, unknown>;
  /** Invalid attributes for a new entry and the member they point at. */
  invalid: [Record<string, unknown>, string][];
  /** Attributes of a second entry that collides with `create`, and the colliding member. */
  duplicate: [Record<string, unknown>, string][];
  /** Columns of the stand-in catalog table that reference the entry. */
  reference: (id: number) => Record<string, string | number>;
}

/** Stand-ins for the URLs of two platform icons, uploaded before each test. */
const ICON = '<icon>';
const OTHER_ICON = '<other icon>';

const VOCABULARIES: VocabularyCase[] = [
  {
    type: 'countries',
    create: { code: 'kr', name: '  Corea del Sur  ' },
    created: { code: 'KR', name: 'Corea del Sur' },
    update: { name: 'República de Corea' },
    updated: { code: 'KR', name: 'República de Corea' },
    invalid: [
      [{ code: 'KOR', name: 'Corea del Sur' }, '/data/attributes/code'],
      [{ code: 'K1', name: 'Corea del Sur' }, '/data/attributes/code'],
      [{ code: 'KR', name: '  ' }, '/data/attributes/name'],
      [{ name: 'Corea del Sur' }, '/data/attributes/code'],
    ],
    duplicate: [[{ code: 'KR', name: 'Otra' }, 'code']],
    reference: (id) => ({ country_id: id }),
  },
  {
    type: 'genres',
    create: { slug: 'k-pop', name: 'K-pop' },
    created: { slug: 'k-pop', name: 'K-pop' },
    update: { slug: 'kpop' },
    updated: { slug: 'kpop', name: 'K-pop' },
    invalid: [
      [{ slug: 'K-Pop', name: 'K-pop' }, '/data/attributes/slug'],
      [{ slug: 'k--pop', name: 'K-pop' }, '/data/attributes/slug'],
      [{ slug: 'k-pop', name: null }, '/data/attributes/name'],
    ],
    duplicate: [[{ slug: 'k-pop', name: 'Otro' }, 'slug']],
    reference: (id) => ({ genre_id: id }),
  },
  {
    type: 'organization-types',
    create: { slug: 'agency', name: 'Agencia', description: 'Representa artistas' },
    created: { slug: 'agency', name: 'Agencia', description: 'Representa artistas' },
    update: { description: null },
    updated: { slug: 'agency', name: 'Agencia', description: null },
    invalid: [
      [{ slug: 'agency', name: 'Agencia', description: 7 }, '/data/attributes/description'],
      [{ name: 'Agencia' }, '/data/attributes/slug'],
    ],
    duplicate: [[{ slug: 'agency', name: 'Otra' }, 'slug']],
    reference: (id) => ({ organization_type_id: id }),
  },
  {
    type: 'platforms',
    create: { name: 'Spotify', slug: 'spotify', iconUrl: ICON, supportsTrack: true },
    created: {
      name: 'Spotify',
      slug: 'spotify',
      iconUrl: ICON,
      supportsCatalogIdentity: false,
      supportsTrack: true,
      supportsAlbum: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    update: { supportsAlbum: true },
    updated: { supportsTrack: true, supportsAlbum: true },
    invalid: [
      [{ name: 'Spotify', slug: 'spotify', iconUrl: 'ftp://img.example.com/spotify.svg' }, '/data/attributes/iconUrl'],
      [{ name: 'Spotify', slug: 'spotify' }, '/data/attributes/iconUrl'],
      [{ name: 'Spotify', slug: 'spotify', iconUrl: 'https://cdn.example.com/spotify.svg' }, '/data/attributes/iconUrl'],
      [{ name: 'Spotify', slug: 'spotify', iconUrl: OTHER_ICON, supportsTrack: 'yes' }, '/data/attributes/supportsTrack'],
    ],
    duplicate: [
      [{ name: 'Spotify', slug: 'spotify-2', iconUrl: OTHER_ICON }, 'name'],
      [{ name: 'Spotify 2', slug: 'spotify', iconUrl: OTHER_ICON }, 'slug'],
      [{ name: 'Spotify 2', slug: 'spotify-2', iconUrl: ICON }, 'iconUrl'],
    ],
    reference: (id) => ({ platform_id: id }),
  },
  {
    type: 'contribution-roles',
    create: { slug: 'composer', name: 'Composición', category: 'writing', scopes: ['work', 'membership'] },
    created: { slug: 'composer', name: 'Composición', description: null, category: 'writing', scopes: ['work', 'membership'] },
    update: { scopes: ['membership', 'recording', 'work'] },
    updated: { category: 'writing', scopes: ['work', 'recording', 'membership'] },
    invalid: [
      [{ slug: 'composer', name: 'Composición', category: 'marketing', scopes: ['work'] }, '/data/attributes/category'],
      [{ slug: 'composer', name: 'Composición', category: 'writing', scopes: [] }, '/data/attributes/scopes'],
      [{ slug: 'composer', name: 'Composición', category: 'writing', scopes: ['work', 'work'] }, '/data/attributes/scopes'],
      [{ slug: 'composer', name: 'Composición', category: 'writing', scopes: ['album'] }, '/data/attributes/scopes'],
      [{ slug: 'composer', name: 'Composición', category: 'writing' }, '/data/attributes/scopes'],
    ],
    duplicate: [[{ slug: 'composer', name: 'Otro', category: 'writing', scopes: ['work'] }, 'slug']],
    reference: (id) => ({ contribution_role_id: id, role_scope: 'work' }),
  },
];

describe('vocabularies', () => {
  let app: TestApp;
  let dataSource: DataSource;
  let admin: Account;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.app.get(DataSource);
    await createVocabularyReferencesTable(dataSource);
  });

  let icons: Record<string, string>;

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    icons = {
      [ICON]: await uploadedPlatformIconUrl(app, admin.accessToken, 'icon'),
      [OTHER_ICON]: await uploadedPlatformIconUrl(app, admin.accessToken, 'other icon'),
    };
  });

  /** `attributes` with the icon stand-ins replaced by the uploaded URLs. */
  const withIcons = (attributes: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(attributes).map(([name, value]) => [name, icons[value as string] ?? value]));

  afterAll(async () => {
    await dropVocabularyReferencesTable(dataSource);
    await app.close();
  });

  describe.each(VOCABULARIES)('$type', (vocabulary) => {
    const { type } = vocabulary;
    const create = (attributes = vocabulary.create, token = admin.accessToken) => createEntry(app, token, type, withIcons(attributes));

    it('lets an administrator create an entry, which anyone can read', async () => {
      const response = await create().expect(201);

      expect(response.headers['content-type']).toBe(JSON_API);
      const id = response.body.data.id;
      expect(id).toMatch(/^\d+$/);
      expect(response.body).toEqual({
        jsonapi: { version: '1.1' },
        data: { type, id, attributes: expect.objectContaining(withIcons(vocabulary.created)) },
        links: { self: `/v1/${type}/${id}` },
      });

      const shown = await getPublic(app, `${type}/${id}`).expect(200);
      expect(shown.body.data).toEqual(response.body.data);
      const listed = await getPublic(app, type).expect(200);
      expect(listed.body.data).toEqual([response.body.data]);
      expect(listed.body.meta).toEqual({ total: 1 });
    });

    it.each(vocabulary.invalid)('validates a new entry (%j)', async (attributes, pointer) => {
      const response = await create(attributes).expect(422);

      expect(response.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: { pointer } })]));
    });

    it.each(vocabulary.duplicate)('refuses an entry that collides with another (%j)', async (attributes, member) => {
      await create().expect(201);

      const response = await create(attributes).expect(409);

      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: `${member}_taken`, source: { pointer: `/data/attributes/${member}` } }),
      ]);
    });

    it('lets an administrator update an entry partially', async () => {
      const id = await createdEntryId(app, admin.accessToken, type, withIcons(vocabulary.create));

      const response = await updateEntry(app, admin.accessToken, type, id, vocabulary.update).expect(200);

      expect(response.body.data).toEqual({ type, id, attributes: expect.objectContaining(vocabulary.updated) });
      expect((await getPublic(app, `${type}/${id}`).expect(200)).body.data).toEqual(response.body.data);
    });

    it('refuses an update whose id does not match the URL', async () => {
      const id = await createdEntryId(app, admin.accessToken, type, withIcons(vocabulary.create));

      const response = await sendJsonApi(app.server, 'patch', `/v1/${type}/${id}`, {
        data: { type, id: String(Number(id) + 1), attributes: vocabulary.update },
      })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'id_mismatch' })]);
    });

    it('lets an administrator delete an unused entry', async () => {
      const id = await createdEntryId(app, admin.accessToken, type, withIcons(vocabulary.create));

      const response = await deleteEntry(app, admin.accessToken, type, id).expect(204);

      expect(response.text).toBe('');
      await getPublic(app, `${type}/${id}`).expect(404);
    });

    it('refuses to delete an entry in use, without cascading', async () => {
      const id = await createdEntryId(app, admin.accessToken, type, withIcons(vocabulary.create));
      await referenceEntry(dataSource, vocabulary.reference(Number(id)));

      const response = await deleteEntry(app, admin.accessToken, type, id).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'in_use' })]);
      await getPublic(app, `${type}/${id}`).expect(200);
      expect(await dataSource.query('SELECT count(*)::int AS count FROM vocabulary_references')).toEqual([{ count: 1 }]);
    });

    it('answers 404 for an unknown entry', async () => {
      for (const id of ['999999', 'abc', '99999999999']) {
        await getPublic(app, `${type}/${id}`).expect(404);
        await updateEntry(app, admin.accessToken, type, id, vocabulary.update).expect(404);
        await deleteEntry(app, admin.accessToken, type, id).expect(404);
      }
    });

    it.each(['user', 'moderator'] as const)('answers 403 to a %s writing', async (role) => {
      const diego = await registerVerified(app, 'diego_papi');
      if (role === 'moderator') {
        await changeRole(app, admin.accessToken, diego.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
      }
      const id = await createdEntryId(app, admin.accessToken, type, withIcons(vocabulary.create));

      await create(vocabulary.create, diego.accessToken).expect(403);
      await updateEntry(app, diego.accessToken, type, id, vocabulary.update).expect(403);
      await deleteEntry(app, diego.accessToken, type, id).expect(403);
    });

    it('requires an access token to write', async () => {
      await create(vocabulary.create, 'not-a-token').expect(401);
    });

    it('rejects unsupported query parameters', async () => {
      await getPublic(app, type, { 'filter[unknown]': 'x' }).expect(400);
      await getPublic(app, type, { sort: 'unknown' }).expect(400);
    });
  });

  /** The ids of the listed entries, in order. */
  const listIds = async (type: string, query: Record<string, string> = {}) =>
    (await getPublic(app, type, query).expect(200)).body.data.map((entry: { id: string }) => entry.id);

  describe('countries filters and order', () => {
    it('sorts by name by default and also by code, and filters by name or code', async () => {
      const kr = await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'Corea del Sur' });
      const jp = await createdEntryId(app, admin.accessToken, 'countries', { code: 'JP', name: 'Japón' });
      const ar = await createdEntryId(app, admin.accessToken, 'countries', { code: 'AR', name: 'Argentina' });

      expect(await listIds('countries')).toEqual([ar, kr, jp]);
      expect(await listIds('countries', { sort: '-code' })).toEqual([kr, jp, ar]);
      expect(await listIds('countries', { 'filter[q]': 'JAPON' })).toEqual([jp]);
      expect(await listIds('countries', { 'filter[q]': 'rea' })).toEqual([kr]);
      expect(await listIds('countries', { 'filter[q]': '%' })).toEqual([]);
      expect(await listIds('countries', { 'filter[code]': 'ar' })).toEqual([ar]);
    });
  });

  describe('genres and organization types filters and order', () => {
    it.each(['genres', 'organization-types'])('sorts %s by name and filters by name or slug', async (type) => {
      const trot = await createdEntryId(app, admin.accessToken, type, { slug: 'trot', name: 'Trot' });
      const ballad = await createdEntryId(app, admin.accessToken, type, { slug: 'ballad', name: 'Balada' });

      expect(await listIds(type)).toEqual([ballad, trot]);
      expect(await listIds(type, { sort: '-name' })).toEqual([trot, ballad]);
      expect(await listIds(type, { 'filter[q]': 'bal' })).toEqual([ballad]);
      expect(await listIds(type, { 'filter[slug]': 'trot' })).toEqual([trot]);
    });
  });

  describe('platforms filters and order', () => {
    it('filters by what a platform supports', async () => {
      const spotify = await createdEntryId(app, admin.accessToken, 'platforms', {
        name: 'Spotify',
        slug: 'spotify',
        iconUrl: icons[ICON],
        supportsCatalogIdentity: true,
        supportsTrack: true,
        supportsAlbum: true,
      });
      const instagram = await createdEntryId(app, admin.accessToken, 'platforms', {
        name: 'Instagram',
        slug: 'instagram',
        iconUrl: icons[OTHER_ICON],
        supportsCatalogIdentity: true,
      });

      expect(await listIds('platforms')).toEqual([instagram, spotify]);
      expect(await listIds('platforms', { 'filter[supports]': 'catalog_identity' })).toEqual([instagram, spotify]);
      expect(await listIds('platforms', { 'filter[supports]': 'track' })).toEqual([spotify]);
      expect(await listIds('platforms', { 'filter[supports]': 'album', 'filter[q]': 'insta' })).toEqual([]);
      expect(await listIds('platforms', { 'filter[slug]': 'instagram' })).toEqual([instagram]);
      await getPublic(app, 'platforms', { 'filter[supports]': 'artist' }).expect(400);
    });

    it('moves updatedAt on each update', async () => {
      const id = await createdEntryId(app, admin.accessToken, 'platforms', {
        name: 'Melon',
        slug: 'melon',
        iconUrl: icons[ICON],
      });
      app.clock.advance(60_000);

      const response = await updateEntry(app, admin.accessToken, 'platforms', id, { name: 'Melon Music' }).expect(200);

      expect(response.body.data.attributes).toMatchObject({
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
      });
    });
  });

  describe('platform icons', () => {
    const platform = (iconUrl: string, slug = 'spotify') =>
      createdEntryId(app, admin.accessToken, 'platforms', { name: slug, slug, iconUrl });

    it.each([
      ['an external URL', async () => 'https://open.spotify.com/favicon.ico'],
      ['a catalog upload', async () => uploadedImageUrl(app, admin.accessToken)],
      ['an avatar', async () => uploadedAvatarUrl(app, admin.accessToken)],
    ])('refuses %s as an icon', async (_, url) => {
      const iconUrl = await url();
      const id = await platform(icons[ICON]);

      for (const response of [
        await createEntry(app, admin.accessToken, 'platforms', { name: 'Melon', slug: 'melon', iconUrl }).expect(422),
        await updateEntry(app, admin.accessToken, 'platforms', id, { iconUrl }).expect(422),
      ]) {
        expect(response.body.errors).toEqual([
          expect.objectContaining({ code: 'unknown_platform_icon', source: { pointer: '/data/attributes/iconUrl' } }),
        ]);
      }
      expect((await getPublic(app, `platforms/${id}`).expect(200)).body.data.attributes.iconUrl).toBe(icons[ICON]);
    });

    it('removes the file of a replaced icon, which no platform can use again', async () => {
      const id = await platform(icons[ICON]);

      const response = await updateEntry(app, admin.accessToken, 'platforms', id, { iconUrl: icons[OTHER_ICON] }).expect(200);

      expect(response.body.data.attributes.iconUrl).toBe(icons[OTHER_ICON]);
      await fetchImage(app, icons[ICON]).expect(404);
      expect(await fileRemovedAt(app, icons[ICON])).toEqual(app.clock.now());
      await fetchImage(app, icons[OTHER_ICON]).expect(200);
      const reused = await createEntry(app, admin.accessToken, 'platforms', { name: 'Melon', slug: 'melon', iconUrl: icons[ICON] }).expect(422);
      expect(reused.body.errors).toEqual([expect.objectContaining({ code: 'unknown_platform_icon' })]);
    });

    it('keeps the icon of an update that does not replace it', async () => {
      const id = await platform(icons[ICON]);

      await updateEntry(app, admin.accessToken, 'platforms', id, { name: 'Spotify', iconUrl: icons[ICON] }).expect(200);
      await updateEntry(app, admin.accessToken, 'platforms', id, { supportsTrack: true }).expect(200);

      await fetchImage(app, icons[ICON]).expect(200);
      expect(await fileRemovedAt(app, icons[ICON])).toBeNull();
    });

    it('removes the icon file of a deleted platform, and keeps it while the platform is in use', async () => {
      const used = await platform(icons[ICON]);
      await referenceEntry(dataSource, { platform_id: Number(used) });
      const unused = await platform(icons[OTHER_ICON], 'melon');

      await deleteEntry(app, admin.accessToken, 'platforms', used).expect(409);
      await deleteEntry(app, admin.accessToken, 'platforms', unused).expect(204);

      await fetchImage(app, icons[ICON]).expect(200);
      await fetchImage(app, icons[OTHER_ICON]).expect(404);
      expect(await fileRemovedAt(app, icons[OTHER_ICON])).toEqual(app.clock.now());
    });
  });

  describe('contribution roles scopes, filters and order', () => {
    const role = (slug: string, name: string, category: string, scopes: string[]) =>
      createdEntryId(app, admin.accessToken, 'contribution-roles', { slug, name, category, scopes });

    it('refuses to remove a scope in use, and keeps the rest of the update from applying', async () => {
      const id = await role('composer', 'Composición', 'writing', ['work', 'recording']);
      await referenceEntry(dataSource, { contribution_role_id: Number(id), role_scope: 'work' });

      const response = await updateEntry(app, admin.accessToken, 'contribution-roles', id, {
        name: 'Composición musical',
        scopes: ['recording'],
      }).expect(409);

      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'scope_in_use', source: { pointer: '/data/attributes/scopes' } })]);
      const shown = await getPublic(app, `contribution-roles/${id}`).expect(200);
      expect(shown.body.data.attributes).toMatchObject({ name: 'Composición', scopes: ['work', 'recording'] });

      await updateEntry(app, admin.accessToken, 'contribution-roles', id, { scopes: ['work'] }).expect(200);
      expect((await getPublic(app, `contribution-roles/${id}`).expect(200)).body.data.attributes.scopes).toEqual(['work']);
    });

    it('filters by category and scope and sorts by name or category', async () => {
      const vocals = await role('vocals', 'Voz', 'performance', ['recording', 'membership']);
      const lyricist = await role('lyricist', 'Letra', 'writing', ['work']);
      const mixing = await role('mixing', 'Mezcla', 'engineering', ['recording', 'release']);

      expect(await listIds('contribution-roles')).toEqual([lyricist, mixing, vocals]);
      // Categories sort in their declared order: writing, arrangement, performance, production, engineering.
      expect(await listIds('contribution-roles', { sort: 'category,name' })).toEqual([lyricist, vocals, mixing]);
      expect(await listIds('contribution-roles', { 'filter[category]': 'writing' })).toEqual([lyricist]);
      expect(await listIds('contribution-roles', { 'filter[scope]': 'recording' })).toEqual([mixing, vocals]);
      expect(await listIds('contribution-roles', { 'filter[scope]': 'recording', 'filter[q]': 'voz' })).toEqual([vocals]);
      expect(await listIds('contribution-roles', { 'filter[slug]': 'mixing' })).toEqual([mixing]);

      // Filtering by scope still lists every scope of the matching roles.
      const listed = await getPublic(app, 'contribution-roles', { 'filter[scope]': 'release' }).expect(200);
      expect(listed.body.data[0].attributes.scopes).toEqual(['recording', 'release']);

      await getPublic(app, 'contribution-roles', { 'filter[category]': 'marketing' }).expect(400);
      await getPublic(app, 'contribution-roles', { 'filter[scope]': 'album' }).expect(400);
    });
  });
});
