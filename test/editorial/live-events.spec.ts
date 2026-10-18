import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, decideChange, getJsonApi, reserveEntity, submitProposal } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const present = (value: unknown) => ({ exists: true, value });

describe('tours and events in the editorial flow', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let ana: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    ana = await registerVerified(app, 'ana');
  });

  afterAll(async () => {
    await app.close();
  });

  const apply = (changeId: string) => decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  const reject = (changeId: string) => decideChange(app, moderator.accessToken, changeId, { action: 'reject', reason: 'Sin fuente fiable' });

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Datos del concierto');
    const changeIds: string[] = [];
    for (const change of changes) changeIds.push((await addChange(app, ana.accessToken, proposalId, change).expect(201)).body.data.id);
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return changeIds;
  }

  const reserve = async (entityType: string): Promise<string> => (await reserveEntity(app, ana.accessToken, entityType).expect(201)).body.data.id;
  const creation = (entityId: string, targetPath: string, value: object): ChangeInput => ({ entityId, operation: 'create_entity', targetPath, proposedValue: present(value) });
  const setField = (entityId: string, targetPath: string, value: unknown): ChangeInput => ({ entityId, operation: 'set_fields', targetPath, proposedValue: present(value) });

  async function publish(entityType: string, targetPath: string, value: object): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve(entityType);
    const [changeId] = await submitChanges([creation(entityId, targetPath, value)]);
    const response = await apply(changeId).expect(201);
    return { entityId, id: response.body.included[0].attributes.resultKey.publicId };
  }

  async function publishArtist(displayName: string): Promise<{ entityId: string; id: string }> {
    const identity = await publish('identity', 'catalog_identities', { type: 'organization', displayName, organization: {} });
    const [changeId] = await submitChanges([
      { entityId: identity.entityId, operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: identity.entityId } }, proposedValue: present({}) },
    ]);
    await apply(changeId).expect(201);
    return identity;
  }

  /** The 422 pointers of an invalid change on a fresh draft. */
  async function pointers(change: ChangeInput): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken);
    const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(422);
    return body.errors.map(({ source }: { source: { pointer: string } }) => source.pointer);
  }

  describe('roots', () => {
    it('publishes a tour and an event of it, with business states apart from publication', async () => {
      const tour = await publish('tour', 'tours', { title: 'BORN PINK World Tour', status: 'scheduled', startDate: { year: 2022, month: 10 } });
      const event = await publish('event', 'events', {
        title: 'BORN PINK in Seoul',
        status: 'scheduled',
        tour: { entity_id: tour.entityId },
        startDate: { year: 2022, month: 10, day: 15 },
        startTime: '19:00',
        timezone: 'Asia/Seoul',
        city: 'Seúl',
        venueName: 'KSPO Dome',
      });

      const { body } = await getJsonApi(app, `/v1/events/${event.id}?include=tour`).expect(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          type: 'events',
          id: event.id,
          attributes: expect.objectContaining({
            publicationStatus: 'published',
            title: 'BORN PINK in Seoul',
            type: 'concert',
            status: 'scheduled',
            startDate: { year: 2022, month: 10, day: 15 },
            startTime: '19:00',
            timezone: 'Asia/Seoul',
            city: 'Seúl',
            venueName: 'KSPO Dome',
          }),
          relationships: expect.objectContaining({ tour: { data: { type: 'tours', id: tour.id } }, country: { data: null } }),
          meta: { editorialEntityId: event.entityId },
        }),
      );
      expect(body.included[0].attributes).toEqual(expect.objectContaining({ title: 'BORN PINK World Tour', status: 'scheduled', startDate: { year: 2022, month: 10, day: null } }));
    });

    it('creates an event with a tour of the same proposal, which a rejected tour blocks', async () => {
      const tourId = await reserve('tour');
      const eventId = await reserve('event');
      const [tourChange, eventChange] = await submitChanges([
        creation(tourId, 'tours', { title: 'Tour', status: 'announced' }),
        creation(eventId, 'events', { title: 'Show', status: 'announced', tour: { entity_id: tourId } }),
      ]);

      await reject(tourChange).expect(201);
      const { body } = await getJsonApi(app, `/v1/proposal-changes/${eventChange}/decisions`, ana.accessToken).expect(200);
      expect(body.data.map(({ attributes }: { attributes: { action: string } }) => attributes.action)).toContain('block_dependency');
    });

    it('validates partial dates, a time with a complete date and an IANA zone, and states against dates', async () => {
      const event = await reserve('event');
      const at = (value: object) => pointers(creation(event, 'events', { title: 'Show', status: 'announced', ...value }));
      const base = '/data/attributes/proposedValue/value';

      expect(await at({ startDate: { year: 2026, month: 2, day: 30 } })).toEqual([`${base}/startDate/day`]);
      expect(await at({ startDate: { year: 2026, month: 2 }, startTime: '19:00', timezone: 'Asia/Seoul' })).toEqual([`${base}/startTime`]);
      expect(await at({ startDate: { year: 2026, month: 2, day: 1 }, startTime: '19:00' })).toEqual([`${base}/timezone`]);
      expect(await at({ timezone: 'GMT+9' })).toEqual([`${base}/timezone`]);
      expect(await at({ status: 'scheduled', startDate: { year: 2026, month: 2 } })).toEqual([`${base}/startDate`]);
      expect(await at({ status: 'postponed', startDate: { year: 2026 } })).toEqual([`${base}/startDate`]);
      expect(await at({ status: 'played' })).toEqual([`${base}/status`]);

      const tour = await reserve('tour');
      const tourAt = (value: object) => pointers(creation(tour, 'tours', { title: 'Tour', status: 'announced', ...value }));
      expect(await tourAt({ status: 'scheduled' })).toEqual([`${base}/startDate`]);
      expect(await tourAt({ startDate: { year: 2026, month: 5 }, endDate: { year: 2026, month: 4 } })).toEqual([`${base}/endDate`]);
      // A year and a month within it overlap, so they are in a possible order.
      const draft = await createDraft(app, ana.accessToken);
      await addChange(app, ana.accessToken, draft, creation(tour, 'tours', { title: 'Tour', status: 'in_progress', startDate: { year: 2026 }, endDate: { year: 2026, month: 1 } })).expect(201);
    }, 30000);

    it('accepts a zone without a time, and postpones by clearing the date it had', async () => {
      const event = await publish('event', 'events', {
        title: 'Show',
        status: 'scheduled',
        startDate: { year: 2026, month: 12, day: 5 },
        startTime: '18:30',
        timezone: 'America/Lima',
      });
      const [postpone] = await submitChanges([
        setField(event.entityId, 'events.schedule', { status: 'postponed', startDate: null, startTime: null, timezone: 'America/Lima' }),
      ]);
      const { body: decision } = await apply(postpone).expect(201);
      expect(decision.included[0].attributes.beforeValue).toEqual(
        present({ status: 'scheduled', startDate: { year: 2026, month: 12, day: 5 }, startTime: '18:30', timezone: 'America/Lima' }),
      );

      const { body } = await getJsonApi(app, `/v1/events/${event.id}`).expect(200);
      expect(body.data.attributes).toEqual(expect.objectContaining({ status: 'postponed', startDate: null, startTime: null, timezone: 'America/Lima' }));
    });

    it('changes the location of an event and refuses an unknown country', async () => {
      const country = await createdEntryId(app, admin.accessToken, 'countries', { code: 'PE', name: 'Perú' });
      const event = await publish('event', 'events', { title: 'Show', status: 'announced' });

      expect(await pointers(setField(event.entityId, 'events.location', { countryId: 99999, city: null, venueName: null }))).toEqual([
        '/data/attributes/proposedValue/value/countryId',
      ]);
      const [change] = await submitChanges([setField(event.entityId, 'events.location', { countryId: Number(country), city: 'Lima', venueName: 'Estadio Nacional' })]);
      await apply(change).expect(201);

      const { body } = await getJsonApi(app, `/v1/events/${event.id}?include=country`).expect(200);
      expect(body.data.attributes).toEqual(expect.objectContaining({ city: 'Lima', venueName: 'Estadio Nacional' }));
      expect(body.included).toEqual([expect.objectContaining({ type: 'countries', id: country, attributes: { code: 'PE', name: 'Perú' } })]);
    });
  });

  describe('artists, organizers and links', () => {
    it('announces artists keyed by the identity of their profile, and refuses an identity without one', async () => {
      const blackpink = await publishArtist('BLACKPINK');
      const agency = await publish('identity', 'catalog_identities', { type: 'organization', displayName: 'YG Entertainment', organization: {} });
      const event = await publish('event', 'events', { title: 'Show', status: 'announced' });
      const key = (identity: string) => ({ event_id: { entity_id: event.entityId }, artist_id: { entity_id: identity } });

      const proposalId = await createDraft(app, ana.accessToken);
      const { body: refused } = await addChange(app, ana.accessToken, proposalId, {
        entityId: event.entityId,
        operation: 'add_relation',
        targetPath: 'event_artists',
        targetKey: key(agency.entityId),
        proposedValue: present({ role: 'main', position: 0 }),
      }).expect(422);
      expect(refused.errors[0].code).toBe('no_artist_profile');

      const [announce] = await submitChanges([
        { entityId: event.entityId, operation: 'add_relation', targetPath: 'event_artists', targetKey: key(blackpink.entityId), proposedValue: present({ role: 'main', position: 0 }) },
        {
          entityId: event.entityId,
          operation: 'add_relation',
          targetPath: 'event_organizers',
          targetKey: { event_id: { entity_id: event.entityId }, catalog_identity_id: { entity_id: agency.entityId } },
          proposedValue: present({ position: 0, details: 'Promotora' }),
        },
        {
          entityId: event.entityId,
          operation: 'add_relation',
          targetPath: 'event_links',
          proposedValue: present({ label: 'Entradas', url: 'https://tickets.example.com/show', purpose: 'tickets', position: 0 }),
        },
      ]);
      await apply(announce).expect(201);
      const changes = await getJsonApi(app, `/v1/moderation/changes`, moderator.accessToken).expect(200);
      for (const { id } of changes.body.data) await apply(id).expect(201);

      const { body } = await getJsonApi(app, `/v1/events/${event.id}?include=artists.artist,organizers.identity,links`).expect(200);
      const included = (type: string) => body.included.filter((resource: { type: string }) => resource.type === type);
      expect(included('event-artists')[0].attributes).toEqual({ role: 'main', position: 0, creditedAs: null });
      expect(included('event-organizers')[0].attributes).toEqual({ position: 0, details: 'Promotora' });
      expect(included('event-links')[0].attributes).toEqual({ label: 'Entradas', url: 'https://tickets.example.com/show', purpose: 'tickets', position: 0 });
      expect(included('artists')).toHaveLength(1);
      expect(included('identities').map(({ attributes }: { attributes: { displayName: string } }) => attributes.displayName)).toEqual(['YG Entertainment']);
    }, 30000);

    it('refuses a link that is not HTTP(S) or has another purpose', async () => {
      const tour = await publish('tour', 'tours', { title: 'Tour', status: 'announced' });
      const link = (value: object) =>
        pointers({ entityId: tour.entityId, operation: 'add_relation', targetPath: 'tour_links', proposedValue: present({ label: 'Web', position: 0, ...value }) });

      expect(await link({ url: 'ftp://example.com', purpose: 'official' })).toEqual(['/data/attributes/proposedValue/value/url']);
      expect(await link({ url: 'https://example.com', purpose: 'merch' })).toEqual(['/data/attributes/proposedValue/value/purpose']);
    });

    it('keeps an artist profile announced in a tour from being removed', async () => {
      const artist = await publishArtist('TWICE');
      const tour = await publish('tour', 'tours', { title: 'READY TO BE', status: 'announced' });
      const [announce] = await submitChanges([
        {
          entityId: tour.entityId,
          operation: 'add_relation',
          targetPath: 'tour_artists',
          targetKey: { tour_id: { entity_id: tour.entityId }, artist_id: { entity_id: artist.entityId } },
          proposedValue: present({ role: 'main', position: 0 }),
        },
      ]);
      await apply(announce).expect(201);

      const proposalId = await createDraft(app, ana.accessToken);
      const { body } = await addChange(app, ana.accessToken, proposalId, {
        entityId: artist.entityId,
        operation: 'remove_relation',
        targetPath: 'artists',
        targetKey: { catalog_identity_id: { entity_id: artist.entityId } },
        proposedValue: { exists: false },
      }).expect(422);
      expect(body.errors[0].code).toBe('artist_referenced');
      expect(JSON.stringify(body.errors)).toContain('tours o conciertos');
    });
  });
});
