import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const present = (value: unknown) => ({ exists: true, value });

describe('global search (S1)', () => {
  let app: TestApp;
  let admin: Account;
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};

  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  async function publishRoot(name: string, entityType: string, targetPath: string, value: object): Promise<void> {
    const entityId = (await reserveEntity(app, admin.accessToken, entityType).expect(201)).body.data.id;
    await publish([{ entityId, operation: 'create_entity', targetPath, proposedValue: present(value) }]);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    roots[name] = entityId;
    const { publicId, id } = revisions.body.data[0].attributes.resultKey;
    publicIds[name] = publicId ?? String(id);
  }

  const organization = (name: string, displayName: string) =>
    publishRoot(name, 'identity', 'catalog_identities', { type: 'organization', displayName, organization: {} });

  /** The `type:id` of each result, in order. */
  async function search(query: string, status = 200): Promise<string[]> {
    const { body } = await getJsonApi(app, `/v1/search?${query}`).expect(status);
    return status === 200 ? body.data.map(({ type, id }: { type: string; id: string }) => `${type}:${id}`) : body.errors;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await organization('blackpink', 'BLACKPINK');
    await publish([
      { entityId: roots.blackpink, operation: 'add_relation', targetPath: 'catalog_identity_aliases', proposedValue: present({ alias: '블랙핑크', isPrimary: false, sortOrder: 0 }) },
      { entityId: roots.blackpink, operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots.blackpink } }, proposedValue: present({}) },
    ]);
    await publishRoot('beyonce', 'identity', 'catalog_identities', { type: 'person', displayName: 'Beyoncé', person: {} });
    await organization('gone', 'BLACKPINK Fan Union');
    await publish([{ entityId: roots.gone, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
    // A reservation, never published.
    await reserveEntity(app, admin.accessToken, 'identity').expect(201);

    await publishRoot('bornPink', 'release_group', 'release_groups', { title: 'BORN PINK', type: 'album' });
    await publishRoot('standard', 'release', 'releases', { releaseGroup: { entity_id: roots.bornPink } });
    await publishRoot('deluxe', 'release', 'releases', { releaseGroup: { entity_id: roots.bornPink }, title: 'BORN PINK (Pink Venom Edition)', editionName: 'Deluxe' });
    await publishRoot('shutDown', 'work', 'works', { title: 'Shut Down' });
    await publishRoot('shutDownRecording', 'recording', 'recordings', { title: 'Shut Down' });
    await publish([
      {
        entityId: roots.deluxe,
        operation: 'add_relation',
        targetPath: 'tracks',
        targetKey: { release_id: { entity_id: roots.deluxe } },
        proposedValue: present({ recording: { entity_id: roots.shutDownRecording }, discNumber: 1, trackNumber: 1, title: 'Shut Down (Remix Ver.)' }),
      },
    ]);
    await publishRoot('tour', 'tour', 'tours', { title: 'BORN PINK World Tour', status: 'completed' });
    await publishRoot('event', 'event', 'events', { title: 'BORN PINK in Seoul', status: 'performed' });

    const identity = await getJsonApi(app, `/v1/identities/${publicIds.blackpink}`).expect(200);
    publicIds.blackpinkArtist = identity.body.data.relationships.artist.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('tolerates typing errors in romanizations', async () => {
    expect(await search('filter[q]=blackpnk')).toEqual([`identities:${publicIds.blackpink}`]);
  });

  it('finds Korean text inside an alias, and ignores case and accents', async () => {
    expect(await search('filter[q]=블랙')).toEqual([`identities:${publicIds.blackpink}`]);
    expect(await search('filter[q]=BEYONCE')).toEqual([`identities:${publicIds.beyonce}`]);
  });

  it('returns a release group once, never its releases, also when a release title matches', async () => {
    const results = await search('filter[q]=born%20pink');
    expect(results.filter((result) => result.startsWith('release-groups:'))).toEqual([`release-groups:${publicIds.bornPink}`]);
    expect(results.some((result) => result.startsWith('releases:'))).toBe(false);
    expect(await search('filter[q]=venom')).toEqual([`release-groups:${publicIds.bornPink}`]);
  });

  it('ranks a name equal to the text above names that contain it, across types', async () => {
    const results = await search('filter[q]=born%20pink');
    expect(results[0]).toBe(`release-groups:${publicIds.bornPink}`);
    expect(results.slice(1).sort()).toEqual([`events:${publicIds.event}`, `tours:${publicIds.tour}`].sort());
    const { body } = await getJsonApi(app, '/v1/search?filter[q]=born%20pink&page[size]=1').expect(200);
    expect(body.meta.total).toBe(3);
    expect(body.data).toHaveLength(1);
  });

  it('limits the types searched, and finds artists only when asked for', async () => {
    expect(await search('filter[q]=shut%20down&filter[type]=works')).toEqual([`works:${publicIds.shutDown}`]);
    expect((await search('filter[q]=shut%20down')).sort()).toEqual([`recordings:${publicIds.shutDownRecording}`, `works:${publicIds.shutDown}`].sort());
    expect(await search('filter[q]=blackpink&filter[type]=artists,tours')).toEqual([`artists:${publicIds.blackpinkArtist}`]);
  });

  it('finds a recording, never a track, by the title of one of its tracks', async () => {
    expect(await search('filter[q]=remix%20ver')).toEqual([`recordings:${publicIds.shutDownRecording}`]);
  });

  it('excludes reservations and withdrawn entries', async () => {
    expect(await search('filter[q]=fan%20union')).toEqual([]);
  });

  it('shows the content of each result', async () => {
    const { body } = await getJsonApi(app, '/v1/search?filter[q]=tour&filter[type]=tours').expect(200);
    expect(body.data[0].attributes).toEqual(expect.objectContaining({ title: 'BORN PINK World Tour', status: 'completed' }));
  });

  it('requires a text and refuses unknown types and parameters', async () => {
    await search('', 400);
    await search('filter[q]=%20%20', 400);
    await search('filter[q]=pink&filter[type]=releases', 400);
    await search('filter[q]=pink&include=artist', 400);
    await search('filter[q]=pink&sort=title', 400);
  });
});
