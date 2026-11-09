import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);
type Resource = { type: string; id: string; attributes: Record<string, unknown>; relationships: Record<string, { data: unknown }> };
const ofType = (body: { included?: Resource[] }, type: string) => (body.included ?? []).filter((resource) => resource.type === type);

/*
 * The artist credit of a recording and the printed credit of a track
 * (ADR 0008), with "Sin Pijama" by Becky G and Natti Natasha: its single
 * shows the recording's credit, and a compilation prints "Becky G" alone.
 */
describe('artist credits of recordings and printed credits of tracks', () => {
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
    await publishRoot(name, 'identity', 'catalog_identities', { type: 'person', displayName, person: {} });
    await publish([
      { entityId: roots[name], operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots[name] } }, proposedValue: present({}) },
    ]);
    const { body } = await getJsonApi(app, `/v1/identities/${publicIds[name]}`).expect(200);
    publicIds[`${name}Artist`] = body.data.relationships.artist.data.id;
  }

  async function publishRelease(name: string, title: string, type: string): Promise<void> {
    await publishRoot(`${name}Group`, 'release_group', 'release_groups', { title, type });
    await publishRoot(name, 'release', 'releases', { releaseGroup: { entity_id: roots[`${name}Group`] } });
  }

  async function publishTrack(name: string, release: string, recording: string, trackNumber: number): Promise<void> {
    const [key] = await publish([
      {
        entityId: roots[release],
        operation: 'add_relation',
        targetPath: 'tracks',
        targetKey: { release_id: { entity_id: roots[release] } },
        proposedValue: present({ recording: { entity_id: roots[recording] }, discNumber: 1, trackNumber }),
      },
    ]);
    tracks[name] = String(key.id);
  }

  const recordingCredit = (recording: string, artist: string, value: object): ChangeInput => ({
    entityId: roots[recording],
    operation: 'add_relation',
    targetPath: 'recording_artist_credits',
    targetKey: { recording_id: { entity_id: roots[recording] }, artist_id: { entity_id: roots[artist] } },
    proposedValue: present(value),
  });

  const printedCredit = (release: string, track: string, artist: string, value: object): ChangeInput => ({
    entityId: roots[release],
    operation: 'add_relation',
    targetPath: 'track_artist_credits',
    targetKey: { track_id: Number(tracks[track]), artist_id: { entity_id: roots[artist] } },
    proposedValue: present(value),
  });

  const withdrawal = (name: string): ChangeInput => ({
    entityId: roots[name],
    operation: 'withdraw_entity',
    targetPath: 'publication_status',
    proposedValue: present('withdrawn'),
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await publishArtist('becky', 'Becky G');
    await publishArtist('natti', 'Natti Natasha');
    await publishArtist('jennie', 'JENNIE');
    await publishRoot('sinPijama', 'recording', 'recordings', { title: 'Sin Pijama' });
    await publishRoot('solo', 'recording', 'recordings', { title: 'SOLO' });
    await publishRoot('gone', 'recording', 'recordings', { title: 'Retirada' });
    await publishRoot('uncredited', 'recording', 'recordings', { title: 'Sin crédito propio' });
    await publish([
      recordingCredit('sinPijama', 'becky', { rank: 'main', position: 0 }),
      recordingCredit('sinPijama', 'natti', { rank: 'main', position: 1 }),
      recordingCredit('solo', 'jennie', { rank: 'main', position: 0 }),
      recordingCredit('gone', 'becky', { rank: 'main', position: 0 }),
    ]);

    await publishRelease('single', 'Sin Pijama', 'single');
    await publishRelease('compilation', 'Reggaetón Hits', 'compilation');
    await publishRelease('album', 'BLACKPINK IN YOUR AREA', 'album');
    await publishRelease('hidden', 'Retirada', 'single');
    await publishTrack('singleTrack', 'single', 'sinPijama', 1);
    await publishTrack('goneTrack', 'single', 'gone', 2);
    await publishTrack('compilationTrack', 'compilation', 'sinPijama', 1);
    await publishTrack('uncreditedTrack', 'compilation', 'uncredited', 2);
    await publishTrack('albumTrack', 'album', 'solo', 1);
    await publishTrack('hiddenTrack', 'hidden', 'uncredited', 1);
    await publish([
      printedCredit('compilation', 'compilationTrack', 'becky', { rank: 'main', position: 0 }),
      printedCredit('compilation', 'uncreditedTrack', 'natti', { rank: 'featured', position: 0 }),
      printedCredit('album', 'albumTrack', 'jennie', { rank: 'main', position: 0, creditedAs: 'JENNIE (BLACKPINK)' }),
      printedCredit('hidden', 'hiddenTrack', 'jennie', { rank: 'main', position: 0 }),
    ]);
    await publish([withdrawal('gone')]);
    await publish([withdrawal('hidden')]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the artist credit of a recording', () => {
    it('lists its artists by position, with the name to show and the link to each artist profile', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${publicIds.sinPijama}?include=artistCredits.artist`).expect(200);

      expect(body.data.relationships.artistCredits.data).toEqual([
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.beckyArtist}` },
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.nattiArtist}` },
      ]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes, relationships }) => [attributes, relationships])).toEqual([
        [{ rank: 'main', position: 0, creditedAs: null, displayName: 'Becky G' }, { artist: { data: { type: 'artists', id: publicIds.beckyArtist } } }],
        [{ rank: 'main', position: 1, creditedAs: null, displayName: 'Natti Natasha' }, { artist: { data: { type: 'artists', id: publicIds.nattiArtist } } }],
      ]);
      expect(ids({ data: ofType(body, 'artists') })).toEqual([publicIds.beckyArtist, publicIds.nattiArtist]);
    });

    it('shows the artists of each recording in the list', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings?filter[q]=pijama&include=artistCredits&fields[recording-artist-credits]=displayName`).expect(200);

      expect(ids(body)).toEqual([publicIds.sinPijama]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Becky G', 'Natti Natasha']);
    });

    it('refuses an include deeper than the artist', async () => {
      await getJsonApi(app, `/v1/recordings/${publicIds.sinPijama}?include=artistCredits.artist.identity`).expect(400);
    });
  });

  describe('the credit a track shows', () => {
    const trackCredits = async (track: string) => {
      const { body } = await getJsonApi(app, `/v1/tracks/${tracks[track]}?include=artistCredits.artist`).expect(200);
      return { linkage: body.data.relationships.artistCredits.data, body };
    };

    it('inherits the credit of its recording without a printed one, read when it is shown', async () => {
      const { linkage, body } = await trackCredits('singleTrack');

      expect(linkage).toEqual([
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.beckyArtist}` },
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.nattiArtist}` },
      ]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Becky G', 'Natti Natasha']);
      expect(ofType(body, 'artists')).toHaveLength(2);
    });

    it('shows its printed credit whole, instead of the credit of its recording', async () => {
      const { linkage, body } = await trackCredits('compilationTrack');

      expect(linkage).toEqual([{ type: 'track-artist-credits', id: `${tracks.compilationTrack}.${publicIds.beckyArtist}` }]);
      expect(ofType(body, 'track-artist-credits').map(({ attributes }) => attributes)).toEqual([
        { rank: 'main', position: 0, creditedAs: null, displayName: 'Becky G' },
      ]);
      expect(ofType(body, 'recording-artist-credits')).toEqual([]);
    });

    it('shows the name a release printed, and the display name in the credit of the recording', async () => {
      const printed = await trackCredits('albumTrack');
      expect(ofType(printed.body, 'track-artist-credits')[0].attributes.displayName).toBe('JENNIE (BLACKPINK)');
      const recording = await getJsonApi(app, `/v1/recordings/${publicIds.solo}?include=artistCredits`).expect(200);
      expect(ofType(recording.body, 'recording-artist-credits')[0].attributes.displayName).toBe('JENNIE');
    });

    it('shows no artists when its recording is withdrawn and it has no printed credit', async () => {
      expect((await trackCredits('goneTrack')).linkage).toEqual([]);
    });

    it('tells inherited and printed credits apart in a tracklist', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.compilation}/tracks?include=artistCredits`).expect(200);

      expect(body.data.map(({ relationships }: Resource) => (relationships.artistCredits.data as { type: string }[]).map(({ type }) => type))).toEqual([
        ['track-artist-credits'],
        ['track-artist-credits'],
      ]);
      const single = await getJsonApi(app, `/v1/releases/${publicIds.single}/tracks?include=artistCredits&fields[recording-artist-credits]=rank`).expect(200);
      expect(ofType(single.body, 'recording-artist-credits').map(({ attributes }) => attributes)).toEqual([{ rank: 'main' }, { rank: 'main' }]);
    });
  });

  describe('the tracks of an artist (C9)', () => {
    it('lists the tracks that show the artist, inherited or printed', async () => {
      const natti = await getJsonApi(app, `/v1/artists/${publicIds.nattiArtist}/tracks`).expect(200);
      expect(ids(natti.body).sort()).toEqual([tracks.singleTrack, tracks.uncreditedTrack].sort());

      const becky = await getJsonApi(app, `/v1/artists/${publicIds.beckyArtist}/tracks`).expect(200);
      // The track of the withdrawn recording shows no artists.
      expect(ids(becky.body).sort()).toEqual([tracks.singleTrack, tracks.compilationTrack].sort());
    });

    it('filters by the rank of the credit each track shows', async () => {
      const featured = await getJsonApi(app, `/v1/artists/${publicIds.nattiArtist}/tracks?filter[rank]=featured`).expect(200);
      expect(ids(featured.body)).toEqual([tracks.uncreditedTrack]);
      const main = await getJsonApi(app, `/v1/artists/${publicIds.nattiArtist}/tracks?filter[rank]=main`).expect(200);
      expect(ids(main.body)).toEqual([tracks.singleTrack]);
    });
  });

  describe('recordings by artist', () => {
    it('finds a recording by its artist credit, or by the printed credit of a track in a published release', async () => {
      const natti = await getJsonApi(app, `/v1/recordings?filter[artist]=${publicIds.nattiArtist}`).expect(200);
      expect(ids(natti.body).sort()).toEqual([publicIds.sinPijama, publicIds.uncredited].sort());

      // JENNIE is printed on a track of a withdrawn release, which does not count.
      const jennie = await getJsonApi(app, `/v1/recordings?filter[artist]=${publicIds.jennieArtist}`).expect(200);
      expect(ids(jennie.body)).toEqual([publicIds.solo]);
    });
  });

  describe('the artist credit of a release group', () => {
    it('shows the name to show', async () => {
      await publish([
        {
          entityId: roots.singleGroup,
          operation: 'add_relation',
          targetPath: 'release_artist_credits',
          targetKey: { release_group_id: { entity_id: roots.singleGroup }, artist_id: { entity_id: roots.natti } },
          proposedValue: present({ position: 0, creditedAs: 'NATTI NATASHA' }),
        },
        {
          entityId: roots.singleGroup,
          operation: 'add_relation',
          targetPath: 'release_artist_credits',
          targetKey: { release_group_id: { entity_id: roots.singleGroup }, artist_id: { entity_id: roots.becky } },
          proposedValue: present({ position: 1 }),
        },
      ]);

      const { body } = await getJsonApi(app, `/v1/release-groups/${publicIds.singleGroup}?include=artistCredits`).expect(200);

      expect(ofType(body, 'release-artist-credits').map(({ attributes }) => attributes)).toEqual([
        { position: 0, creditedAs: 'NATTI NATASHA', displayName: 'NATTI NATASHA' },
        { position: 1, creditedAs: null, displayName: 'Becky G' },
      ]);
    });
  });
});
