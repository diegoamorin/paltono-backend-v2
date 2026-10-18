import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, personCreation, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const MINUTE = 60 * 1000;
const present = (value: unknown) => ({ exists: true, value });

describe('works (M1–M3), recordings (M4–M6) and the credits of an identity (C4)', () => {
  let app: TestApp;
  let admin: Account;
  /** Editorial roots and public ids by name. */
  const roots: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, number> = {};
  const genres: Record<string, number> = {};

  /** Publishes the given microchanges directly, as staff may (E18). */
  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  /** Creates a root, then the rest of its data, and remembers it by name. */
  async function publishRoot(name: string, entityType: string, targetPath: string, value: object, later: (entityId: string) => ChangeInput[] = () => []) {
    const entityId = (await reserveEntity(app, admin.accessToken, entityType).expect(201)).body.data.id;
    await publish([{ entityId, operation: 'create_entity', targetPath, proposedValue: present(value) }]);
    const extra = later(entityId);
    if (extra.length > 0) await publish(extra);
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    const { resultKey } = revisions.body.data[0].attributes;
    roots[name] = entityId;
    ids[name] = resultKey.publicId ?? resultKey.id;
    app.clock.advance(MINUTE);
  }

  const credit = (entityId: string, targetPath: string, identity: string, role: string, position = 0): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath,
    proposedValue: present({ identity: { entity_id: roots[identity] }, roleId: roles[role], position }),
  });

  const link = (entityId: string, work: string, relationType: string, position: number | null = null): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath: 'recording_works',
    proposedValue: present({ work: { entity_id: roots[work] }, relationType, position }),
  });

  const genre = (entityId: string, slug: string, isPrimary: boolean): ChangeInput => ({
    entityId,
    operation: 'add_relation',
    targetPath: 'recording_genres',
    targetKey: { recording_id: { entity_id: entityId }, genre_id: genres[slug] },
    proposedValue: present({ isPrimary }),
  });

  async function withdraw(name: string): Promise<void> {
    await publish([{ entityId: roots[name], operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    const role = async (slug: string, category: string, scopes: string[]) => {
      roles[slug] = Number(await createdEntryId(app, admin.accessToken, 'contribution-roles', { slug, name: slug, category, scopes }));
    };
    await role('composer', 'writing', ['work']);
    await role('lyricist', 'writing', ['work']);
    await role('producer', 'production', ['recording']);
    genres['k-pop'] = Number(await createdEntryId(app, admin.accessToken, 'genres', { slug: 'k-pop', name: 'K-pop' }));
    genres['ballad'] = Number(await createdEntryId(app, admin.accessToken, 'genres', { slug: 'ballad', name: 'Balada' }));

    await publishRoot('IU', 'identity', 'catalog_identities', personCreation().value);
    await publishRoot('Yoon Sang', 'identity', 'catalog_identities', personCreation({ displayName: 'Yoon Sang' }).value);
    await publishRoot('Retirado', 'identity', 'catalog_identities', personCreation({ displayName: 'Retirado' }).value);

    await publishRoot('Butter', 'work', 'works', { title: 'Butter', iswc: 'T0345246801' }, (entityId) => [
      credit(entityId, 'work_contributions', 'Yoon Sang', 'lyricist'),
    ]);
    await publishRoot('Good Day', 'work', 'works', { title: '좋은 날' }, (entityId) => [
      credit(entityId, 'work_contributions', 'IU', 'composer'),
      credit(entityId, 'work_contributions', 'Retirado', 'lyricist', 1),
    ]);
    await publishRoot('Árbol', 'work', 'works', { title: 'Árbol' }, (entityId) => [credit(entityId, 'work_contributions', 'Yoon Sang', 'composer')]);
    await publishRoot('Withdrawn work', 'work', 'works', { title: 'Obra retirada' }, (entityId) => [
      credit(entityId, 'work_contributions', 'Yoon Sang', 'composer'),
    ]);

    await publishRoot('Butter recording', 'recording', 'recordings', { title: 'Butter', isrc: 'USA2P2125949', recordingDate: { year: 2021, month: 5 } }, (entityId) => [
      genre(entityId, 'k-pop', true),
      link(entityId, 'Butter', 'performance'),
      credit(entityId, 'recording_contributions', 'IU', 'producer'),
    ]);
    await publishRoot('Remix', 'recording', 'recordings', { title: 'Butter (Remix)', recordingDate: { year: 2021, month: 6 } }, (entityId) => [
      link(entityId, 'Butter', 'sample'),
    ]);
    await publishRoot('Good Day recording', 'recording', 'recordings', { title: '좋은 날', isExplicit: true, recordingDate: { year: 2010 } }, (entityId) => [
      genre(entityId, 'ballad', false),
      link(entityId, 'Good Day', 'performance', 1),
      link(entityId, 'Árbol', 'performance', 2),
    ]);
    await publishRoot('Undated', 'recording', 'recordings', { title: 'Sin fecha' });
    await publishRoot('Withdrawn recording', 'recording', 'recordings', { title: 'Butter retirada' }, (entityId) => [link(entityId, 'Butter', 'performance')]);

    await withdraw('Withdrawn work');
    await withdraw('Withdrawn recording');
    await withdraw('Retirado');
    // Reservations are never listed.
    await reserveEntity(app, admin.accessToken, 'work').expect(201);
    await reserveEntity(app, admin.accessToken, 'recording').expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  type Body = { data: { id: string; type: string; attributes: Record<string, unknown> }[] };
  const titles = (body: Body) => body.data.map(({ attributes }) => attributes.title);

  describe('GET /v1/works (M1)', () => {
    it('lists published works by title, with their editorial ids', async () => {
      const { body } = await getJsonApi(app, '/v1/works').expect(200);

      expect(titles(body)).toEqual(['Árbol', 'Butter', '좋은 날']);
      expect(body.meta).toEqual({ total: 3 });
      expect(body.data[1]).toEqual(expect.objectContaining({ type: 'works', id: ids.Butter, meta: { editorialEntityId: roots.Butter } }));
    });

    it('resolves a work by slug, ISWC and title, ignoring case and accents', async () => {
      expect(titles((await getJsonApi(app, '/v1/works?filter[slug]=좋은-날').expect(200)).body)).toEqual(['좋은 날']);
      expect(titles((await getJsonApi(app, '/v1/works?filter[iswc]=T0345246801').expect(200)).body)).toEqual(['Butter']);
      expect(titles((await getJsonApi(app, '/v1/works?filter[q]=ARBOL').expect(200)).body)).toEqual(['Árbol']);
      expect((await getJsonApi(app, '/v1/works?filter[slug]=no-existe').expect(200)).body.data).toEqual([]);
    });

    it('filters by contributor and role, together in one credit', async () => {
      const yoon = ids['Yoon Sang'];
      expect(titles((await getJsonApi(app, `/v1/works?filter[contributor]=${yoon}`).expect(200)).body)).toEqual(['Árbol', 'Butter']);
      expect(titles((await getJsonApi(app, `/v1/works?filter[contributor]=${yoon}&filter[role]=composer`).expect(200)).body)).toEqual(['Árbol']);
      expect(titles((await getJsonApi(app, '/v1/works?filter[role]=composer').expect(200)).body)).toEqual(['Árbol', '좋은 날']);
    });

    it('sorts by newest first and rejects what the matrix does not list', async () => {
      expect(titles((await getJsonApi(app, '/v1/works?sort=-createdAt').expect(200)).body)).toEqual(['Árbol', '좋은 날', 'Butter']);
      await getJsonApi(app, '/v1/works?filter[genre]=k-pop').expect(400);
      await getJsonApi(app, '/v1/works?sort=slug').expect(400);
      await getJsonApi(app, '/v1/works?include=recordingWorks.recording.contributions').expect(400);
    });
  });

  describe('GET /v1/works/{id} (M2)', () => {
    it('shows a work with its credits and the recordings that use it', async () => {
      const { body } = await getJsonApi(app, `/v1/works/${ids.Butter}?include=contributions.role,recordingWorks.recording`).expect(200);

      expect(body.data.attributes).toEqual(expect.objectContaining({ title: 'Butter', slug: 'butter', iswc: 'T0345246801' }));
      expect(body.data.relationships.contributions.data).toHaveLength(1);
      const recordings = body.included.filter(({ type }: { type: string }) => type === 'recordings');
      // A withdrawn recording shows only its notice, even when reached from the work.
      expect(recordings.map(({ attributes }: { attributes: { title?: string; publicationStatus: string } }) => attributes.title ?? attributes.publicationStatus).sort()).toEqual([
        'Butter',
        'Butter (Remix)',
        'withdrawn',
      ]);
      expect(body.included.find(({ type }: { type: string }) => type === 'contribution-roles').attributes.slug).toBe('lyricist');
    });

    it('shows only the notice of a withdrawn work and 404 for an unknown one', async () => {
      const { body } = await getJsonApi(app, `/v1/works/${ids['Withdrawn work']}`).expect(200);
      expect(body.data).toEqual({
        type: 'works',
        id: ids['Withdrawn work'],
        attributes: { publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) },
        meta: { editorialEntityId: roots['Withdrawn work'] },
      });

      await getJsonApi(app, '/v1/works/999999').expect(404);
      await getJsonApi(app, '/v1/works/butter').expect(404);
    });
  });

  describe('GET /v1/works/{id}/recordings (M3)', () => {
    it('lists the published recordings of a work, by relation type', async () => {
      const all = await getJsonApi(app, `/v1/works/${ids.Butter}/recordings?include=recordingWorks`).expect(200);
      expect(titles(all.body)).toEqual(['Butter', 'Butter (Remix)']);

      const samples = await getJsonApi(app, `/v1/works/${ids.Butter}/recordings?filter[relationType]=sample`).expect(200);
      expect(titles(samples.body)).toEqual(['Butter (Remix)']);

      await getJsonApi(app, `/v1/works/${ids.Butter}/recordings?filter[relationType]=cover`).expect(400);
      await getJsonApi(app, '/v1/works/999999/recordings').expect(404);
      expect((await getJsonApi(app, `/v1/works/${ids['Withdrawn work']}/recordings`).expect(200)).body.data).toEqual([]);
    });
  });

  describe('GET /v1/recordings (M4)', () => {
    it('lists published recordings by title', async () => {
      const { body } = await getJsonApi(app, '/v1/recordings').expect(200);

      expect(titles(body)).toEqual(['Butter', 'Butter (Remix)', 'Sin fecha', '좋은 날']);
      expect(body.data[0]).toEqual(expect.objectContaining({ type: 'recordings', id: ids['Butter recording'], meta: { editorialEntityId: roots['Butter recording'] } }));
    });

    it('filters by title, ISRC, genre, contributor, work, year and explicit content', async () => {
      const filtered = async (query: string) => titles((await getJsonApi(app, `/v1/recordings?${query}`).expect(200)).body);

      expect(await filtered('filter[q]=remix')).toEqual(['Butter (Remix)']);
      expect(await filtered('filter[isrc]=USA2P2125949')).toEqual(['Butter']);
      expect(await filtered('filter[genre]=ballad')).toEqual(['좋은 날']);
      expect(await filtered(`filter[contributor]=${ids.IU}`)).toEqual(['Butter']);
      expect(await filtered(`filter[work]=${ids['Árbol']}`)).toEqual(['좋은 날']);
      expect(await filtered('filter[year]=2021')).toEqual(['Butter', 'Butter (Remix)']);
      expect(await filtered('filter[isExplicit]=true')).toEqual(['좋은 날']);
      expect(await filtered(`filter[artist]=${ids.IU}`)).toEqual([]);
      await getJsonApi(app, '/v1/recordings?filter[isExplicit]=yes').expect(400);
      await getJsonApi(app, '/v1/recordings?filter[year]=dosmil').expect(400);
    });

    it('sorts by recording date with unknown dates last', async () => {
      expect(titles((await getJsonApi(app, '/v1/recordings?sort=-recordingDate').expect(200)).body)).toEqual(['Butter (Remix)', 'Butter', '좋은 날', 'Sin fecha']);
      expect(titles((await getJsonApi(app, '/v1/recordings?sort=recordingDate').expect(200)).body)).toEqual(['좋은 날', 'Butter', 'Butter (Remix)', 'Sin fecha']);
    });
  });

  describe('GET /v1/recordings/{id} (M5) and /tracks (M6)', () => {
    it('shows a recording with its genres, works in medley order and credits', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${ids['Good Day recording']}?include=genres,recordingWorks.work,tracks`).expect(200);

      expect(body.data.attributes).toEqual(
        expect.objectContaining({ title: '좋은 날', isExplicit: true, recordingDate: { year: 2010, month: null, day: null }, primaryGenreId: null }),
      );
      expect(body.data.relationships.tracks).toEqual({ data: [] });
      const works = body.included.filter(({ type }: { type: string }) => type === 'works');
      expect(works.map(({ attributes }: { attributes: { title: string } }) => attributes.title)).toEqual(['좋은 날', 'Árbol']);
    });

    it('shows only the notice of a withdrawn recording and 404 for an unknown one', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${ids['Withdrawn recording']}`).expect(200);
      expect(body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect(body.data.relationships).toBeUndefined();
      await getJsonApi(app, '/v1/recordings/unknown').expect(404);
    });

    it('lists the appearances of a recording in editions, none until editions have tracks', async () => {
      const { body } = await getJsonApi(app, `/v1/recordings/${ids['Butter recording']}/tracks`).expect(200);
      expect(body).toEqual(expect.objectContaining({ data: [], meta: { total: 0 } }));
      await getJsonApi(app, '/v1/recordings/unknown/tracks').expect(404);
    });
  });

  describe('GET /v1/identities/{id}/credits (C4)', () => {
    const credited = (body: Body & { included?: { type: string; id: string; attributes: Record<string, unknown> }[] }) =>
      body.data.map(({ type, relationships }: { type: string; relationships?: Record<string, { data: { id: string } }> } & Body['data'][number]) => {
        const owner = relationships!.work ?? relationships!.recording;
        const target = body.included?.find(({ id }) => id === owner.data.id);
        return `${type} ${target?.attributes.title ?? owner.data.id}`;
      });

    it('gathers the credits of an identity on works and recordings', async () => {
      const { body } = await getJsonApi(app, `/v1/identities/${ids.IU}/credits?include=work,recording,role`).expect(200);

      expect(credited(body)).toEqual(['work-contributions 좋은 날', 'recording-contributions Butter']);
      expect(body.meta).toEqual({ total: 2 });
      expect(body.included.filter(({ type }: { type: string }) => type === 'contribution-roles').map(({ attributes }: { attributes: { slug: string } }) => attributes.slug).sort()).toEqual([
        'composer',
        'producer',
      ]);
    });

    it('filters by scope and role, and leaves out credits on withdrawn entries', async () => {
      const ofIu = async (query: string) => credited((await getJsonApi(app, `/v1/identities/${ids.IU}/credits?include=work,recording&${query}`).expect(200)).body);
      expect(await ofIu('filter[scope]=recording')).toEqual(['recording-contributions Butter']);
      expect(await ofIu('filter[role]=composer')).toEqual(['work-contributions 좋은 날']);
      expect(await ofIu('filter[scope]=release')).toEqual([]);
      await getJsonApi(app, `/v1/identities/${ids.IU}/credits?filter[scope]=membership`).expect(400);

      const yoon = await getJsonApi(app, `/v1/identities/${ids['Yoon Sang']}/credits?include=work`).expect(200);
      expect(credited(yoon.body)).toEqual(['work-contributions Butter', 'work-contributions Árbol']);
    });

    it('answers 404 for an unknown identity and no credits for a withdrawn one', async () => {
      await getJsonApi(app, '/v1/identities/unknown/credits').expect(404);
      expect((await getJsonApi(app, `/v1/identities/${ids.Retirado}/credits`).expect(200)).body.data).toEqual([]);
    });

    it('shows only the notice of a withdrawn identity credited on a work', async () => {
      const { body } = await getJsonApi(app, `/v1/works/${ids['Good Day']}?include=contributions.identity`).expect(200);
      const notices = body.included.filter(({ type, attributes }: { type: string; attributes: { publicationStatus: string } }) => type === 'identities' && attributes.publicationStatus === 'withdrawn');
      expect(notices).toEqual([expect.objectContaining({ id: ids.Retirado, attributes: { publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) } })]);
    });
  });
});
