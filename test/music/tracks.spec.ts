import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

describe('tracks (M6, M9, M10) and credited tracks of an artist (C9)', () => {
  let app: TestApp;
  let admin: Account;
  /** Editorial roots, public ids and track ids by name. */
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};
  const tracks: Record<string, string> = {};

  /** Publishes the given microchanges directly, as staff may (E18); returns the result key of each. */
  async function publish(changes: ChangeInput[]): Promise<Record<string, unknown>[]> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    const changeIds: string[] = [];
    for (const change of changes) changeIds.push((await addChange(app, admin.accessToken, proposalId, change).expect(201)).body.data.id);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const keys: Record<string, unknown>[] = [];
    for (const changeId of changeIds) {
      const { body } = await getJsonApi(app, `/v1/proposal-changes/${changeId}/decisions?include=revision`, admin.accessToken).expect(200);
      keys.push(body.included?.[0]?.attributes.resultKey);
    }
    return keys;
  }

  async function publishRoot(name: string, entityType: string, targetPath: string, value: object): Promise<void> {
    const entityId = (await reserveEntity(app, admin.accessToken, entityType).expect(201)).body.data.id;
    const [key] = await publish([{ entityId, operation: 'create_entity', targetPath, proposedValue: present(value) }]);
    roots[name] = entityId;
    publicIds[name] = key.publicId as string;
  }

  async function publishArtist(name: string, displayName: string): Promise<void> {
    await publishRoot(name, 'identity', 'catalog_identities', { type: 'organization', displayName, organization: {} });
    await publish([
      { entityId: roots[name], operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots[name] } }, proposedValue: present({}) },
    ]);
    const { body } = await getJsonApi(app, `/v1/identities/${publicIds[name]}`).expect(200);
    publicIds[`${name}Artist`] = body.data.relationships.artist.data.id;
  }

  async function publishTrack(name: string, release: string, recording: string, discNumber: number, trackNumber: number, title: string | null = null) {
    const [key] = await publish([
      {
        entityId: roots[release],
        operation: 'add_relation',
        targetPath: 'tracks',
        targetKey: { release_id: { entity_id: roots[release] } },
        proposedValue: present({ recording: { entity_id: roots[recording] }, discNumber, trackNumber, title }),
      },
    ]);
    tracks[name] = String(key.id);
  }

  const credit = (release: string, track: string, artist: string, rank: string, position: number): ChangeInput => ({
    entityId: roots[release],
    operation: 'add_relation',
    targetPath: 'track_artist_credits',
    targetKey: { track_id: Number(tracks[track]), artist_id: { entity_id: roots[artist] } },
    proposedValue: present({ rank, position }),
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await publishArtist('bts', 'BTS');
    await publishArtist('megan', 'Megan Thee Stallion');
    await publishRoot('butter', 'recording', 'recordings', { title: 'Butter' });
    await publishRoot('remix', 'recording', 'recordings', { title: 'Butter (feat. Megan Thee Stallion)', isExplicit: true });
    await publishRoot('gone', 'recording', 'recordings', { title: 'Retirada' });

    await publishRoot('single', 'release_group', 'release_groups', { title: 'Butter', type: 'single' });
    await publishRoot('standard', 'release', 'releases', { releaseGroup: { entity_id: roots.single } });
    await publishRoot('hotter', 'release', 'releases', { releaseGroup: { entity_id: roots.single }, editionName: 'Hotter' });
    await publishRoot('withdrawn', 'release', 'releases', { releaseGroup: { entity_id: roots.single }, editionName: 'Retirada' });

    await publishTrack('second', 'standard', 'gone', 1, 2);
    await publishTrack('first', 'standard', 'butter', 1, 1);
    await publishTrack('bonus', 'standard', 'remix', 2, 1);
    await publishTrack('hotterFirst', 'hotter', 'butter', 1, 1, 'Butter (Hotter Remix)');
    await publishTrack('hidden', 'withdrawn', 'butter', 1, 1);
    await publish([
      credit('standard', 'first', 'bts', 'main', 0),
      credit('standard', 'bonus', 'bts', 'main', 0),
      credit('standard', 'bonus', 'megan', 'featured', 1),
      credit('hotter', 'hotterFirst', 'megan', 'remixer', 0),
    ]);
    await publish([{ entityId: roots.withdrawn, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
    await publish([{ entityId: roots.gone, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/releases/{id}/tracks (M9)', () => {
    it('lists the tracklist by disc and number, with its derived titles', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.standard}/tracks`).expect(200);

      expect(ids(body)).toEqual([tracks.first, tracks.second, tracks.bonus]);
      expect(body.data[0]).toEqual({
        type: 'tracks',
        id: tracks.first,
        attributes: { discNumber: 1, trackNumber: 1, title: null, displayTitle: 'Butter' },
        relationships: {
          release: { data: { type: 'releases', id: publicIds.standard } },
          recording: { data: { type: 'recordings', id: publicIds.butter } },
          artistCredits: { data: [{ type: 'track-artist-credits', id: expect.any(String) }] },
          platformLinks: { data: [] },
        },
      });
      // A withdrawn recording shows only its notice, not its title.
      expect(body.data[1].attributes.displayTitle).toBeNull();
      expect(body.meta.total).toBe(3);
    });

    it('sorts in reverse and includes the recordings and the credited artists', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.standard}/tracks?sort=-discNumber,-trackNumber&include=recording,artistCredits.artist`).expect(200);

      expect(ids(body)).toEqual([tracks.bonus, tracks.second, tracks.first]);
      const types = body.included.map(({ type }: { type: string }) => type);
      expect(new Set(types)).toEqual(new Set(['recordings', 'track-artist-credits', 'artists']));
      const retired = body.included.find(({ type, id }: { type: string; id: string }) => type === 'recordings' && id === publicIds.gone);
      expect(retired.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
    });

    it('shows no tracks of a withdrawn release and answers 404 for an unknown one', async () => {
      expect((await getJsonApi(app, `/v1/releases/${publicIds.withdrawn}/tracks`).expect(200)).body.data).toEqual([]);
      await getJsonApi(app, '/v1/releases/unknown/tracks').expect(404);
    });

    it('refuses an unlisted sort, filter or include', async () => {
      for (const query of ['sort=title', 'filter[rank]=main', 'include=release', 'include=recording.genres']) {
        await getJsonApi(app, `/v1/releases/${publicIds.standard}/tracks?${query}`).expect(400);
      }
    });
  });

  describe('GET /v1/tracks/{id} (M10)', () => {
    it('shows a track with its credits and their artists', async () => {
      const { body } = await getJsonApi(app, `/v1/tracks/${tracks.bonus}?include=artistCredits.artist`).expect(200);

      expect(body.data.attributes).toEqual({ discNumber: 2, trackNumber: 1, title: null, displayTitle: 'Butter (feat. Megan Thee Stallion)' });
      const credits = body.included.filter(({ type }: { type: string }) => type === 'track-artist-credits');
      expect(credits.map(({ attributes }: { attributes: object }) => attributes)).toEqual([
        { rank: 'main', position: 0, creditedAs: null },
        { rank: 'featured', position: 1, creditedAs: null },
      ]);
    });

    it('answers 404 for a track of a withdrawn release, or one that does not exist', async () => {
      await getJsonApi(app, `/v1/tracks/${tracks.hidden}`).expect(404);
      await getJsonApi(app, '/v1/tracks/999999').expect(404);
      await getJsonApi(app, '/v1/tracks/first').expect(404);
    });
  });

  describe('GET /v1/recordings/{id}/tracks (M6) and the tracks of a recording', () => {
    it('lists the appearances of a recording in published releases', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${publicIds.butter}/tracks`).expect(200);
      expect(ids(body).sort()).toEqual([tracks.first, tracks.hotterFirst].sort());
      await getJsonApi(app, '/v1/recordings/unknown/tracks').expect(404);
    });

    it('includes the tracks of a recording with their releases, up to two levels', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${publicIds.butter}?include=tracks.release`).expect(200);

      expect(body.data.relationships.tracks.data.map(({ id }: { id: string }) => id).sort()).toEqual([tracks.first, tracks.hotterFirst].sort());
      const releases = body.included.filter(({ type }: { type: string }) => type === 'releases');
      expect(releases.map(({ id }: { id: string }) => id).sort()).toEqual([publicIds.standard, publicIds.hotter].sort());
      expect(releases[0].relationships.releaseGroup.data).toEqual({ type: 'release-groups', id: publicIds.single });
      await getJsonApi(app, `/v1/recordings/${publicIds.butter}?include=tracks.release.releaseGroup`).expect(400);
    });

    it('filters recordings by an artist credited on their tracks', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings?filter[artist]=${publicIds.meganArtist}`).expect(200);
      expect(ids(body).sort()).toEqual([publicIds.butter, publicIds.remix].sort());
    });
  });

  describe('releases with their tracks', () => {
    it('includes the tracks of a release and their recordings, and derives its explicit content', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.standard}?include=tracks.recording`).expect(200);

      expect(body.data.attributes.isExplicit).toBe(true);
      expect(body.data.relationships.tracks.data.map(({ id }: { id: string }) => id)).toEqual([tracks.first, tracks.second, tracks.bonus]);
      expect(body.included.filter(({ type }: { type: string }) => type === 'recordings')).toHaveLength(3);
      expect((await getJsonApi(app, `/v1/releases/${publicIds.hotter}`).expect(200)).body.data.attributes.isExplicit).toBe(false);
    });
  });

  describe('GET /v1/artists/{id}/tracks (C9)', () => {
    it('lists the tracks an artist is credited on, by rank', async () => {
      const all = await getJsonApi(app, `/v1/artists/${publicIds.meganArtist}/tracks`).expect(200);
      expect(ids(all.body).sort()).toEqual([tracks.bonus, tracks.hotterFirst].sort());
      const remixes = await getJsonApi(app, `/v1/artists/${publicIds.meganArtist}/tracks?filter[rank]=remixer`).expect(200);
      expect(ids(remixes.body)).toEqual([tracks.hotterFirst]);
      const main = await getJsonApi(app, `/v1/artists/${publicIds.btsArtist}/tracks?filter[rank]=main`).expect(200);
      expect(ids(main.body)).toEqual([tracks.first, tracks.bonus]);
    });

    it('refuses an unknown rank and answers 404 for an unknown artist', async () => {
      await getJsonApi(app, `/v1/artists/${publicIds.btsArtist}/tracks?filter[rank]=lead`).expect(400);
      await getJsonApi(app, '/v1/artists/unknown/tracks').expect(404);
    });
  });
});
