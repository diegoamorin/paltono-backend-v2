import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);
type Resource = { type: string; id: string; attributes: Record<string, unknown>; relationships: Record<string, { data: unknown }> };
const ofType = (body: { included?: Resource[] }, type: string) => (body.included ?? []).filter((resource) => resource.type === type);
const date = (year: number, month: number | null = null, day: number | null = null) => ({ year, month, day });
/** A partial date as a payload proposes it, without the parts it lacks. */
const proposed = (year: number, month?: number, day?: number) => ({ year, ...(month && { month }), ...(day && { day }) });

/*
 * The release date of a recording: the earliest partial date of its published,
 * non-cancelled editions with a date, future ones included. And the first
 * recording of a work: of the published recordings that perform it, the one
 * released first. The test clock starts on 2026-01-01.
 */
describe('release dates of recordings and first recordings of works', () => {
  let app: TestApp;
  let admin: Account;
  /** Editorial roots and public ids (or ids, for works) by name. */
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};
  let trackNumber = 0;

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
    publicIds[name] = (key.publicId ?? key.id) as string;
  }

  async function publishArtist(name: string, displayName: string): Promise<void> {
    await publishRoot(name, 'identity', 'catalog_identities', { type: 'person', displayName, person: {} });
    await publish([
      { entityId: roots[name], operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots[name] } }, proposedValue: present({}) },
    ]);
    const { body } = await getJsonApi(app, `/v1/identities/${publicIds[name]}`).expect(200);
    publicIds[`${name}Artist`] = body.data.relationships.artist.data.id;
  }

  /** An edition of its own release, with a track of each recording. */
  async function publishEdition(name: string, value: object, recordings: string[]): Promise<void> {
    await publishRoot(`${name}Release`, 'release', 'releases', { title: name, type: 'single' });
    await publishRoot(name, 'edition', 'editions', { release: { entity_id: roots[`${name}Release`] }, ...value });
    await publish(
      recordings.map((recording) => ({
        entityId: roots[name],
        operation: 'add_relation',
        targetPath: 'tracks',
        targetKey: { edition_id: { entity_id: roots[name] } },
        proposedValue: present({ recording: { entity_id: roots[recording] }, discNumber: 1, trackNumber: ++trackNumber }),
      })),
    );
  }

  const performs = (recording: string, work: string, relationType = 'performance'): ChangeInput => ({
    entityId: roots[recording],
    operation: 'add_relation',
    targetPath: 'recording_works',
    proposedValue: present({ work: { entity_id: roots[work] }, relationType }),
  });

  const recordingCredit = (recording: string, artist: string, position: number): ChangeInput => ({
    entityId: roots[recording],
    operation: 'add_relation',
    targetPath: 'recording_artist_credits',
    targetKey: { recording_id: { entity_id: roots[recording] }, artist_id: { entity_id: roots[artist] } },
    proposedValue: present({ rank: 'main', position }),
  });

  const withdrawal = (name: string): ChangeInput => ({
    entityId: roots[name],
    operation: 'withdraw_entity',
    targetPath: 'publication_status',
    proposedValue: present('withdrawn'),
  });

  const releaseDateOf = async (recording: string) =>
    (await getJsonApi(app, `/v1/recordings/${publicIds[recording]}`).expect(200)).body.data.attributes.releaseDate;

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await publishArtist('becky', 'Becky G');
    await publishArtist('natti', 'Natti Natasha');
    await publishArtist('yoon', 'Yoon Sang');

    // Sin Pijama, recorded in 2017: a cancelled and a withdrawn edition come earlier than its single.
    await publishRoot('sinPijama', 'recording', 'recordings', { title: 'Sin Pijama', recordingDate: proposed(2017) });
    // A recording announced for the future, recorded in 2018.
    await publishRoot('announced', 'recording', 'recordings', { title: 'Anunciada', recordingDate: proposed(2018) });
    // A recording only on an edition without a date and on a cancelled one.
    await publishRoot('undated', 'recording', 'recordings', { title: 'Sin fecha' });
    await publish([recordingCredit('sinPijama', 'becky', 0), recordingCredit('sinPijama', 'natti', 1)]);
    await publishEdition('cancelled', { releaseDate: proposed(2017, 1, 5), isCancelled: true }, ['sinPijama', 'undated']);
    await publishEdition('hidden', { releaseDate: proposed(2017, 6) }, ['sinPijama']);
    await publishEdition('noDate', {}, ['sinPijama', 'undated']);
    await publishEdition('single', { releaseDate: proposed(2018, 4, 20) }, ['sinPijama']);
    await publishEdition('compilation', { releaseDate: proposed(2018, 9) }, ['sinPijama']);
    await publishEdition('upcoming', { releaseDate: proposed(2099, 5) }, ['announced']);
    await publish([withdrawal('hidden')]);

    // Árbol: performed first by Yoon Sang in 2010, covered in 2015 and sampled in 2005.
    await publishRoot('arbol', 'work', 'works', { title: 'Árbol' });
    await publishRoot('original', 'recording', 'recordings', { title: 'Árbol' });
    await publishRoot('cover', 'recording', 'recordings', { title: 'Árbol (cover)' });
    await publishRoot('sample', 'recording', 'recordings', { title: 'Con un sample de Árbol' });
    await publish([recordingCredit('original', 'yoon', 0), performs('original', 'arbol'), performs('cover', 'arbol'), performs('sample', 'arbol', 'sample')]);
    await publishEdition('arbolSingle', { releaseDate: proposed(2010, 3, 1) }, ['original']);
    await publishEdition('arbolCover', { releaseDate: proposed(2015) }, ['cover']);
    await publishEdition('sampler', { releaseDate: proposed(2005) }, ['sample']);

    // A work only performed by a recording without a date, and one only sampled.
    await publishRoot('lost', 'work', 'works', { title: 'Perdida' });
    await publishRoot('sampled', 'work', 'works', { title: 'Solo sampleada' });
    await publish([performs('undated', 'lost'), performs('sample', 'sampled', 'sample')]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the release date of a recording', () => {
    it('is the earliest date of its published, non-cancelled editions with a date', async () => {
      expect(await releaseDateOf('sinPijama')).toEqual(date(2018, 4, 20));
    });

    it('includes an edition still to come', async () => {
      expect(await releaseDateOf('announced')).toEqual(date(2099, 5));
    });

    it('is null without a published, non-cancelled edition with a date', async () => {
      expect(await releaseDateOf('undated')).toBeNull();
    });

    it('sorts the list, with unknown release dates last either way', async () => {
      const sorted = async (sort: string) =>
        ids((await getJsonApi(app, `/v1/recordings?filter[q]=${encodeURIComponent('Árbol')}&sort=${sort}`).expect(200)).body);
      // Árbol was released in 2010, its cover in 2015 and the sampling recording in 2005.
      await publishRoot('unreleasedArbol', 'recording', 'recordings', { title: 'Árbol (demo)' });

      expect(await sorted('releaseDate')).toEqual([publicIds.sample, publicIds.original, publicIds.cover, publicIds.unreleasedArbol]);
      expect(await sorted('-releaseDate')).toEqual([publicIds.cover, publicIds.original, publicIds.sample, publicIds.unreleasedArbol]);
    });

    it('filters the list by release year, apart from the recording year', async () => {
      const filtered = async (filter: string) => ids((await getJsonApi(app, `/v1/recordings?${filter}&sort=title`).expect(200)).body);

      expect(await filtered('filter[releaseYear]=2018')).toEqual([publicIds.sinPijama]);
      expect(await filtered('filter[releaseYear]=2099')).toEqual([publicIds.announced]);
      expect(await filtered('filter[year]=2018')).toEqual([publicIds.announced]);
      expect(await filtered('filter[year]=2017')).toEqual([publicIds.sinPijama]);
      await getJsonApi(app, '/v1/recordings?filter[releaseYear]=2018a').expect(400);
    });
  });

  describe('the first recording of a work', () => {
    const work = async (name: string, include = 'firstRecording,firstRecordingArtistCredits') =>
      (await getJsonApi(app, `/v1/works/${publicIds[name]}?include=${include}`).expect(200)).body;

    it('is the recording that performs it released first, with its date and its artists; a cover released later is not', async () => {
      const body = await work('arbol', 'firstRecording,firstRecordingArtistCredits.artist');

      expect(body.data.attributes.firstReleaseDate).toEqual(date(2010, 3, 1));
      expect(body.data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: publicIds.original });
      expect(body.data.relationships.firstRecordingArtistCredits.data).toEqual([
        { type: 'recording-artist-credits', id: `${publicIds.original}.${publicIds.yoonArtist}` },
      ]);
      expect(ofType(body, 'recordings').map(({ attributes }) => [attributes.title, attributes.releaseDate])).toEqual([['Árbol', date(2010, 3, 1)]]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Yoon Sang']);
      expect(ids({ data: ofType(body, 'artists') })).toEqual([publicIds.yoonArtist]);
    });

    it('does not count a sample, even released earlier', async () => {
      const body = await work('sampled');

      expect(body.data.attributes.firstReleaseDate).toBeNull();
      expect(body.data.relationships.firstRecording.data).toBeNull();
      expect(body.data.relationships.firstRecordingArtistCredits.data).toEqual([]);
    });

    it('may have no release date, and then shows no date', async () => {
      const body = await work('lost');

      expect(body.data.attributes.firstReleaseDate).toBeNull();
      expect(body.data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: publicIds.undated });
    });

    it('becomes an original added after its cover, once the original is released earlier', async () => {
      await publishRoot('tusa', 'work', 'works', { title: 'Tusa' });
      await publishRoot('tusaCover', 'recording', 'recordings', { title: 'Tusa (cover)' });
      await publish([recordingCredit('tusaCover', 'becky', 0), performs('tusaCover', 'tusa')]);
      await publishEdition('tusaCoverSingle', { releaseDate: proposed(2021, 2) }, ['tusaCover']);
      // A recording without a release date goes after one with it, whatever its id.
      await publishRoot('tusaDemo', 'recording', 'recordings', { title: 'Tusa (demo)' });
      await publish([performs('tusaDemo', 'tusa')]);
      expect((await work('tusa')).data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: publicIds.tusaCover });

      await publishRoot('tusaOriginal', 'recording', 'recordings', { title: 'Tusa' });
      await publish([recordingCredit('tusaOriginal', 'natti', 0), performs('tusaOriginal', 'tusa')]);
      await publishEdition('tusaSingle', { releaseDate: proposed(2019, 11, 7) }, ['tusaOriginal']);
      const body = await work('tusa');

      expect(body.data.attributes.firstReleaseDate).toEqual(date(2019, 11, 7));
      expect(body.data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: publicIds.tusaOriginal });
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Natti Natasha']);
    });

    it('breaks a tie of release dates by the public id of the recordings', async () => {
      await publishRoot('twins', 'work', 'works', { title: 'Gemelas' });
      await publishRoot('twinA', 'recording', 'recordings', { title: 'Gemela A' });
      await publishRoot('twinB', 'recording', 'recordings', { title: 'Gemela B' });
      await publish([performs('twinA', 'twins'), performs('twinB', 'twins')]);
      await publishEdition('twinsSingle', { releaseDate: proposed(2020) }, ['twinA', 'twinB']);
      // In the database's text order, ICU's root locale.
      const [first] = [publicIds.twinA, publicIds.twinB].sort((a, b) => a.localeCompare(b, 'und'));

      expect((await work('twins')).data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: first });
    });

    it('is not a withdrawn recording', async () => {
      await publish([withdrawal('original')]);

      expect((await work('arbol')).data.relationships.firstRecording.data).toEqual({ type: 'recordings', id: publicIds.cover });
    });

    it('shows on the works of a list', async () => {
      const { body } = await getJsonApi(app, `/v1/works?filter[q]=${encodeURIComponent('Árbol')}&include=firstRecording`).expect(200);

      expect(body.data.map(({ attributes }: Resource) => attributes.firstReleaseDate)).toEqual([date(2015)]);
      expect(ids({ data: ofType(body, 'recordings') })).toEqual([publicIds.cover]);
    });
  });
});
