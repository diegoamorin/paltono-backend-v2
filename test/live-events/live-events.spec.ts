import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const MINUTE = 60 * 1000;
const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

describe('events (L1, L2), tours (L3–L5) and their organizers and artists (C5, C10)', () => {
  let app: TestApp;
  let admin: Account;
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};
  const countries: Record<string, number> = {};
  let artistId: string;

  /** Publishes the given microchanges directly, as staff may (E18). */
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
    publicIds[name] = revisions.body.data[0].attributes.resultKey.publicId;
    app.clock.advance(MINUTE);
  }

  const tour = (name: string, value: object) => publishRoot(name, 'tour', 'tours', value);
  const event = (name: string, value: object) => publishRoot(name, 'event', 'events', value);
  const ofTour = (name: string) => ({ tour: { entity_id: roots[name] } });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);
    countries.KR = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'KR', name: 'Corea del Sur' }));
    countries.JP = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'JP', name: 'Japón' }));
    countries.PE = Number(await createdEntryId(app, admin.accessToken, 'countries', { code: 'PE', name: 'Perú' }));

    await publishRoot('blackpink', 'identity', 'catalog_identities', { type: 'organization', displayName: 'BLACKPINK', organization: {} });
    await publishRoot('livenation', 'identity', 'catalog_identities', { type: 'organization', displayName: 'Live Nation', organization: {} });
    await publish([
      { entityId: roots.blackpink, operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots.blackpink } }, proposedValue: present({}) },
    ]);

    await tour('bornPink', { title: 'BORN PINK World Tour', status: 'completed', startDate: { year: 2022, month: 10 }, endDate: { year: 2023, month: 9 } });
    await tour('deadline', { title: 'DEADLINE World Tour', status: 'scheduled', startDate: { year: 2025, month: 7 } });
    await tour('gone', { title: 'Gone Tour', status: 'cancelled' });

    await event('seoul', {
      title: 'BORN PINK in Seoul',
      status: 'performed',
      ...ofTour('bornPink'),
      startDate: { year: 2022, month: 10, day: 15 },
      startTime: '19:00',
      timezone: 'Asia/Seoul',
      countryId: countries.KR,
      city: 'Seúl',
      venueName: 'KSPO Dome',
    });
    await event('tokyo', { title: 'BORN PINK in Tokyo', status: 'performed', ...ofTour('bornPink'), startDate: { year: 2023, month: 4 }, countryId: countries.JP, city: 'Tokio' });
    await event('hidden', { title: 'BORN PINK withdrawn stop', status: 'performed', ...ofTour('bornPink'), startDate: { year: 2023, month: 1, day: 1 }, countryId: countries.PE });
    await publish([{ entityId: roots.hidden, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
    await event('lima', { title: 'Concierto en Lima', status: 'announced', countryId: countries.PE, city: 'Lima', venueName: 'Estadio Nacional' });
    await event('postponed', { title: 'DEADLINE in Goyang', status: 'postponed', ...ofTour('deadline') });

    await publish([
      {
        entityId: roots.seoul,
        operation: 'add_relation',
        targetPath: 'event_artists',
        targetKey: { event_id: { entity_id: roots.seoul }, artist_id: { entity_id: roots.blackpink } },
        proposedValue: present({ role: 'main', position: 0 }),
      },
      {
        entityId: roots.lima,
        operation: 'add_relation',
        targetPath: 'event_organizers',
        targetKey: { event_id: { entity_id: roots.lima }, catalog_identity_id: { entity_id: roots.livenation } },
        proposedValue: present({ position: 0 }),
      },
      {
        entityId: roots.bornPink,
        operation: 'add_relation',
        targetPath: 'tour_artists',
        targetKey: { tour_id: { entity_id: roots.bornPink }, artist_id: { entity_id: roots.blackpink } },
        proposedValue: present({ role: 'main', position: 0 }),
      },
      {
        entityId: roots.bornPink,
        operation: 'add_relation',
        targetPath: 'tour_organizers',
        targetKey: { tour_id: { entity_id: roots.bornPink }, catalog_identity_id: { entity_id: roots.livenation } },
        proposedValue: present({ position: 0 }),
      },
      {
        entityId: roots.bornPink,
        operation: 'add_relation',
        targetPath: 'tour_links',
        proposedValue: present({ label: 'Entradas Japón', url: 'https://tickets.example.jp', purpose: 'tickets', position: 0, countryId: countries.JP }),
      },
    ]);
    await event('orphan', { title: 'Stop of a withdrawn tour', status: 'cancelled', ...ofTour('gone') });
    await publish([{ entityId: roots.gone, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);

    const identity = await getJsonApi(app, `/v1/identities/${publicIds.blackpink}`).expect(200);
    artistId = identity.body.data.relationships.artist.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tours', () => {
    it('derives its countries and dates from its published events only', async () => {
      const { body } = await getJsonApi(app, `/v1/tours/${publicIds.bornPink}?include=events,links.country,artists.artist,organizers.identity`).expect(200);

      expect(body.data.attributes).toEqual(
        expect.objectContaining({
          title: 'BORN PINK World Tour',
          status: 'completed',
          startDate: { year: 2022, month: 10, day: null },
          endDate: { year: 2023, month: 9, day: null },
          countries: [
            { code: 'KR', name: 'Corea del Sur' },
            { code: 'JP', name: 'Japón' },
          ],
          eventDates: [
            { year: 2022, month: 10, day: 15 },
            { year: 2023, month: 4, day: null },
          ],
        }),
      );
      expect(body.data.relationships.events.data.map(({ id }: { id: string }) => id)).toEqual([publicIds.seoul, publicIds.tokyo]);
      const types = body.included.map(({ type }: { type: string }) => type).sort();
      expect(types).toEqual(['artists', 'countries', 'events', 'events', 'identities', 'tour-artists', 'tour-links', 'tour-organizers']);
    });

    it('lists published tours by announced start, newest first and undated last, and filters them', async () => {
      expect(ids((await getJsonApi(app, '/v1/tours').expect(200)).body)).toEqual([publicIds.deadline, publicIds.bornPink]);
      expect(ids((await getJsonApi(app, '/v1/tours?filter[country]=jp').expect(200)).body)).toEqual([publicIds.bornPink]);
      expect(ids((await getJsonApi(app, '/v1/tours?filter[country]=PE').expect(200)).body)).toEqual([]);
      expect(ids((await getJsonApi(app, '/v1/tours?filter[status]=scheduled').expect(200)).body)).toEqual([publicIds.deadline]);
      expect(ids((await getJsonApi(app, `/v1/tours?filter[artist]=${artistId}`).expect(200)).body)).toEqual([publicIds.bornPink]);
      expect(ids((await getJsonApi(app, `/v1/tours?filter[organizer]=${publicIds.livenation}`).expect(200)).body)).toEqual([publicIds.bornPink]);
      expect(ids((await getJsonApi(app, '/v1/tours?filter[q]=deadline&sort=title').expect(200)).body)).toEqual([publicIds.deadline]);
    });

    it('lists the events of a tour', async () => {
      const { body } = await getJsonApi(app, `/v1/tours/${publicIds.bornPink}/events?sort=-startDate`).expect(200);
      expect(ids(body)).toEqual([publicIds.tokyo, publicIds.seoul]);
    });

    it('shows only the notice of a withdrawn tour, and no events', async () => {
      const { body } = await getJsonApi(app, `/v1/tours/${publicIds.gone}`).expect(200);
      expect(body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect(body.data.relationships).toBeUndefined();
      expect((await getJsonApi(app, `/v1/tours/${publicIds.gone}/events`).expect(200)).body.data).toEqual([]);
    });

    it('refuses malformed queries and answers 404 for a tour that does not exist', async () => {
      for (const query of ['filter[status]=performed', 'filter[city]=Lima', 'sort=createdAt', 'include=country']) {
        await getJsonApi(app, `/v1/tours?${query}`).expect(400);
      }
      await getJsonApi(app, '/v1/tours/unknown').expect(404);
      await getJsonApi(app, '/v1/tours/unknown/events').expect(404);
    });
  });

  describe('events', () => {
    it('lists published events by date, undated last', async () => {
      const { body } = await getJsonApi(app, '/v1/events').expect(200);
      expect(ids(body).slice(0, 2)).toEqual([publicIds.seoul, publicIds.tokyo]);
      // Undated ones follow, in the database's order of their ids.
      expect(ids(body).slice(2).sort()).toEqual([publicIds.lima, publicIds.postponed, publicIds.orphan].sort());
      expect(body.meta.total).toBe(5);
    });

    it('filters by a date range that a partial date overlaps', async () => {
      expect(ids((await getJsonApi(app, '/v1/events?filter[dateFrom]=2023-04-30&filter[dateTo]=2023-12').expect(200)).body)).toEqual([publicIds.tokyo]);
      expect(ids((await getJsonApi(app, '/v1/events?filter[dateTo]=2022-10-15').expect(200)).body)).toEqual([publicIds.seoul]);
      expect(ids((await getJsonApi(app, '/v1/events?filter[dateFrom]=2022-10-16&filter[dateTo]=2023-03').expect(200)).body)).toEqual([]);
    });

    it('filters by status, country, city, artist, organizer, tour and text', async () => {
      const list = async (query: string) => ids((await getJsonApi(app, `/v1/events?${query}`).expect(200)).body);

      expect(await list('filter[status]=postponed')).toEqual([publicIds.postponed]);
      expect(await list('filter[country]=kr')).toEqual([publicIds.seoul]);
      expect(await list('filter[city]=seul')).toEqual([publicIds.seoul]);
      expect(await list(`filter[artist]=${artistId}`)).toEqual([publicIds.seoul]);
      expect(await list(`filter[organizer]=${publicIds.livenation}`)).toEqual([publicIds.lima]);
      expect(await list(`filter[tour]=${publicIds.deadline}`)).toEqual([publicIds.postponed]);
      expect(await list('filter[q]=estadio')).toEqual([publicIds.lima]);
    });

    it('shows the notice of a withdrawn tour when an event reaches it', async () => {
      const { body } = await getJsonApi(app, `/v1/events/${publicIds.orphan}?include=tour`).expect(200);
      expect(body.included[0]).toEqual(expect.objectContaining({ id: publicIds.gone, attributes: { publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) } }));
    });

    it('refuses malformed queries and answers 404 for an event that does not exist', async () => {
      for (const query of ['filter[status]=completed', 'filter[dateFrom]=2023-13', 'sort=title', 'include=events']) {
        await getJsonApi(app, `/v1/events?${query}`).expect(400);
      }
      await getJsonApi(app, '/v1/events/unknown').expect(404);
      const withdrawn = await getJsonApi(app, `/v1/events/${publicIds.hidden}`).expect(200);
      expect(withdrawn.body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
    });
  });

  describe('organizers and artists', () => {
    it('lists the events and tours an identity organizes', async () => {
      expect(ids((await getJsonApi(app, `/v1/identities/${publicIds.livenation}/organized-events`).expect(200)).body)).toEqual([publicIds.lima]);
      expect(ids((await getJsonApi(app, `/v1/identities/${publicIds.livenation}/organized-tours`).expect(200)).body)).toEqual([publicIds.bornPink]);
      await getJsonApi(app, '/v1/identities/unknown/organized-events').expect(404);
    });

    it('lists the events and tours an artist is announced in', async () => {
      expect(ids((await getJsonApi(app, `/v1/artists/${artistId}/events`).expect(200)).body)).toEqual([publicIds.seoul]);
      expect(ids((await getJsonApi(app, `/v1/artists/${artistId}/tours?filter[status]=completed`).expect(200)).body)).toEqual([publicIds.bornPink]);
      await getJsonApi(app, `/v1/artists/${artistId}/events?filter[city]=Lima`).expect(400);
      await getJsonApi(app, '/v1/artists/unknown/tours').expect(404);
    });
  });
});
