import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const MINUTE = 60 * 1000;
const present = (value: unknown) => ({ exists: true, value });
/** A partial date as a payload proposes it, without the parts it lacks. */
const proposed = (year: number, month?: number, day?: number) => ({ year, ...(month && { month }), ...(day && { day }) });
type Linkage = { type: string; id: string };
type Resource = { type: string; id: string; attributes: Record<string, unknown>; relationships: Record<string, { data: Linkage | Linkage[] | null }> };
type Document = { data: Resource[]; included?: Resource[] };
const ofType = (body: Document, type: string) => (body.included ?? []).filter((resource) => resource.type === type);

/*
 * The credits of an identity read as a discography: with the artists of what
 * they credit, and sorted by when it came out. Andrés, a composer and producer
 * without an artist profile, is credited on "Sin Pijama" by Becky G and Natti
 * Natasha, on the work "Árbol" first recorded by Natti Natasha, on a release
 * and on entries without a date. And the artists of recordings and release
 * groups among search results.
 */
describe('the credits of an identity as a discography, and artists in search', () => {
  let app: TestApp;
  let admin: Account;
  /** Editorial roots and public ids (or ids, for works) by name. */
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};
  const roles: Record<string, number> = {};
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

  /** A release of its own release group, titled after the name, with a track of each recording. */
  async function publishRelease(name: string, title: string, value: object, recordings: string[]): Promise<void> {
    await publishRoot(`${name}Group`, 'release_group', 'release_groups', { title, type: 'single' });
    await publishRoot(name, 'release', 'releases', { releaseGroup: { entity_id: roots[`${name}Group`] }, ...value });
    if (recordings.length === 0) return;
    await publish(
      recordings.map((recording) => ({
        entityId: roots[name],
        operation: 'add_relation',
        targetPath: 'tracks',
        targetKey: { release_id: { entity_id: roots[name] } },
        proposedValue: present({ recording: { entity_id: roots[recording] }, discNumber: 1, trackNumber: ++trackNumber }),
      })),
    );
  }

  const recordingCredit = (recording: string, artist: string, position: number): ChangeInput => ({
    entityId: roots[recording],
    operation: 'add_relation',
    targetPath: 'recording_artist_credits',
    targetKey: { recording_id: { entity_id: roots[recording] }, artist_id: { entity_id: roots[artist] } },
    proposedValue: present({ rank: 'main', position }),
  });

  /** A credit of Andrés on the named entry, in the role. */
  const credit = (name: string, targetPath: string, role: string): ChangeInput => ({
    entityId: roots[name],
    operation: 'add_relation',
    targetPath,
    proposedValue: present({ identity: { entity_id: roots.andres }, roleId: roles[role], position: 0 }),
  });

  /** The names of what each credit of the page credits, in order. */
  const credited = (body: Document) =>
    body.data.map(({ relationships }) => {
      const target = (relationships.work ?? relationships.recording ?? relationships.release).data as Linkage;
      return Object.keys(publicIds).find((name) => publicIds[name] === target.id);
    });

  const creditsOf = async (query = '') =>
    (await getJsonApi(app, `/v1/identities/${publicIds.andres}/credits?page[size]=10${query}`).expect(200)).body as Document;

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    const role = async (slug: string, scope: string) => {
      roles[slug] = Number(await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug, name: slug, category: 'production', scopes: [scope] }));
    };
    await role('composer', 'work');
    await role('producer', 'recording');
    await role('mastering', 'release');

    await publishArtist('becky', 'Becky G');
    await publishArtist('natti', 'Natti Natasha');
    await publishRoot('andres', 'identity', 'catalog_identities', { type: 'person', displayName: 'Andrés', person: {} });

    await publishRoot('sinPijama', 'recording', 'recordings', { title: 'Sin Pijama' });
    await publishRoot('unreleased', 'recording', 'recordings', { title: 'Inédita' });
    await publishRoot('arbol', 'work', 'works', { title: 'Árbol' });
    await publishRoot('original', 'recording', 'recordings', { title: 'Árbol' });
    await publishRoot('unrecorded', 'work', 'works', { title: 'Sin grabar' });
    await publish([
      recordingCredit('sinPijama', 'becky', 0),
      recordingCredit('sinPijama', 'natti', 1),
      recordingCredit('original', 'natti', 0),
      { entityId: roots.original, operation: 'add_relation', targetPath: 'recording_works', proposedValue: present({ work: { entity_id: roots.arbol }, relationType: 'performance' }) },
    ]);
    await publishRelease('single', 'Sin Pijama', { releaseDate: proposed(2018, 4, 20) }, ['sinPijama']);
    await publishRelease('arbolSingle', 'Árbol', { releaseDate: proposed(2010, 3, 1) }, ['original']);
    await publishRelease('remaster', 'Remasterizado', { releaseDate: proposed(2005, 6) }, []);
    await publish([
      {
        entityId: roots.singleGroup,
        operation: 'add_relation',
        targetPath: 'release_artist_credits',
        targetKey: { release_group_id: { entity_id: roots.singleGroup }, artist_id: { entity_id: roots.becky } },
        proposedValue: present({ position: 0 }),
      },
    ]);

    // Andrés's credits, one minute apart, in this order.
    const credits: [string, string, string][] = [
      ['unreleased', 'recording_contributions', 'producer'],
      ['sinPijama', 'recording_contributions', 'producer'],
      ['arbol', 'work_contributions', 'composer'],
      ['remaster', 'release_contributions', 'mastering'],
      ['unrecorded', 'work_contributions', 'composer'],
    ];
    for (const [name, targetPath, role] of credits) {
      app.clock.advance(MINUTE);
      await publish([credit(name, targetPath, role)]);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the credits of an identity', () => {
    it('keep the order of their creation by default', async () => {
      expect(credited(await creditsOf())).toEqual(['unreleased', 'sinPijama', 'arbol', 'remaster', 'unrecorded']);
    });

    it('sort by the release date of what they credit, those without one last', async () => {
      expect(credited(await creditsOf('&sort=releaseDate'))).toEqual(['remaster', 'arbol', 'sinPijama', 'unreleased', 'unrecorded']);
      expect(credited(await creditsOf('&sort=-releaseDate'))).toEqual(['sinPijama', 'arbol', 'remaster', 'unreleased', 'unrecorded']);
    });

    it('page through the order by date', async () => {
      const page = (number: number) => getJsonApi(app, `/v1/identities/${publicIds.andres}/credits?sort=-releaseDate&page[size]=2&page[number]=${number}`).expect(200);
      expect(credited((await page(2)).body)).toEqual(['remaster', 'unreleased']);
      expect((await page(2)).body.meta.total).toBe(5);
    });

    it('include the artists of a credited recording, with the names to show', async () => {
      const body = await creditsOf('&filter[scope]=recording&include=recording.artistCredits');
      const sinPijama = ofType(body, 'recordings').find(({ id }) => id === publicIds.sinPijama)!;
      expect(sinPijama.relationships.artistCredits.data).toEqual([
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.beckyArtist}` },
        { type: 'recording-artist-credits', id: `${publicIds.sinPijama}.${publicIds.nattiArtist}` },
      ]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Becky G', 'Natti Natasha']);
    });

    it('include the first recording of a credited work and its artists', async () => {
      const body = await creditsOf('&filter[scope]=work&include=work.firstRecording,work.firstRecordingArtistCredits');
      const arbol = ofType(body, 'works').find(({ id }) => id === publicIds.arbol)!;
      expect(arbol.attributes.firstReleaseDate).toEqual({ year: 2010, month: 3, day: 1 });
      expect(ofType(body, 'recordings').map(({ id }) => id)).toEqual([publicIds.original]);
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Natti Natasha']);
    });
  });

  describe('search', () => {
    const search = (query: string) => getJsonApi(app, `/v1/search?filter[q]=sin%20pijama${query}`).expect(200);

    it('includes the artists of recordings and release groups on request', async () => {
      const { body } = await search('&include=artistCredits.artist');
      expect(body.data.map(({ type, id }: Linkage) => `${type}:${id}`).sort()).toEqual(
        [`recordings:${publicIds.sinPijama}`, `release-groups:${publicIds.singleGroup}`].sort(),
      );
      expect(ofType(body, 'recording-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Becky G', 'Natti Natasha']);
      expect(ofType(body, 'release-artist-credits').map(({ attributes }) => attributes.displayName)).toEqual(['Becky G']);
      expect(ofType(body, 'artists').map(({ id }) => id).sort()).toEqual([publicIds.beckyArtist, publicIds.nattiArtist].sort());
    });

    it('accepts the include alongside types without artists', async () => {
      const { body } = await getJsonApi(app, '/v1/search?filter[q]=natti&include=artistCredits').expect(200);
      expect(body.data.map(({ type }: Linkage) => type)).toEqual(['identities']);
      expect(body.included).toEqual([]);
    });

    it('includes nothing without include', async () => {
      const { body } = await search('');
      expect(body.included).toBeUndefined();
      expect(body.data.find(({ type }: Linkage) => type === 'recordings').relationships.artistCredits.data).toHaveLength(2);
    });
  });
});
