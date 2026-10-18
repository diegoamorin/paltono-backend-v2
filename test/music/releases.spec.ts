import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;
const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

describe('release groups (M11–M14), releases (M7, M8) and discographies (C8)', () => {
  let app: TestApp;
  let admin: Account;
  /** Editorial roots and public ids by name. */
  const roots: Record<string, string> = {};
  const publicIds: Record<string, string> = {};

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

  const group = (name: string, title: string, type: string) => publishRoot(name, 'release_group', 'release_groups', { title, type });
  const release = (name: string, groupName: string, value: object = {}) =>
    publishRoot(name, 'release', 'releases', { releaseGroup: { entity_id: roots[groupName] }, ...value });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await publishRoot('bts', 'identity', 'catalog_identities', { type: 'organization', displayName: 'BTS', organization: {} });
    await publish([
      { entityId: roots.bts, operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots.bts } }, proposedValue: present({}) },
    ]);

    await group('be', 'BE', 'album');
    await release('beStandard', 'be', { releaseDate: { year: 2020, month: 11, day: 20 }, releaseTime: '14:00', timezone: 'Asia/Seoul' });
    await release('beDeluxe', 'be', { editionName: 'Deluxe', releaseDate: { year: 2026, month: 11, day: 20 }, releaseTime: '18:00', timezone: 'Asia/Seoul' });
    await publish([
      {
        entityId: roots.be,
        operation: 'add_relation',
        targetPath: 'release_artist_credits',
        targetKey: { release_group_id: { entity_id: roots.be }, artist_id: { entity_id: roots.bts } },
        proposedValue: present({ position: 0 }),
      },
    ]);

    await group('next', 'Next', 'ep');
    await release('nextStandard', 'next', { releaseDate: { year: 2026, month: 11 } });
    await release('nextJapan', 'next', { editionName: 'Japan Edition', releaseDate: { year: 2026, month: 10, day: 1 }, isCancelled: true });

    await group('announced', 'Announced', 'single');
    await group('undated', 'Undated', 'single');
    await release('undatedStandard', 'undated', { title: 'Undated (Remixes)' });

    await group('gone', 'Gone', 'album');
    await release('goneStandard', 'gone', { releaseDate: { year: 2021, month: 1, day: 1 } });
    await publish([{ entityId: roots.gone, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => app.clock.set('2026-10-18T00:00:00.000Z'));

  describe('derived availability of a release', () => {
    it('counts down to the instant of its time in its zone, and is released from that instant', async () => {
      const path = `/v1/releases/${publicIds.beDeluxe}`;
      let { body } = await getJsonApi(app, path).expect(200);
      expect(body.data.attributes).toEqual(
        expect.objectContaining({
          releaseDate: { year: 2026, month: 11, day: 20 },
          releaseTime: '18:00',
          timezone: 'Asia/Seoul',
          releaseInstant: '2026-11-20T09:00:00.000Z',
          availability: 'upcoming',
        }),
      );

      app.clock.set('2026-11-20T08:59:59.000Z');
      ({ body } = await getJsonApi(app, path).expect(200));
      expect(body.data.attributes.availability).toBe('upcoming');
      app.clock.set('2026-11-20T09:00:00.000Z');
      ({ body } = await getJsonApi(app, path).expect(200));
      expect(body.data.attributes.availability).toBe('released');
    });

    it('is upcoming until the first day of a partial date, cancelled when cancelled and unknown without a date', async () => {
      const availability = async (name: string) => (await getJsonApi(app, `/v1/releases/${publicIds[name]}`).expect(200)).body.data.attributes.availability;

      expect(await availability('nextStandard')).toBe('upcoming');
      expect(await availability('nextJapan')).toBe('cancelled');
      expect(await availability('undatedStandard')).toBe('unknown');
      app.clock.set('2026-11-01T00:00:00.000Z');
      expect(await availability('nextStandard')).toBe('released');
    });
  });

  describe('derived dates of a release group', () => {
    it('takes its date from its earliest release and its countdown from the next one with an instant', async () => {
      const { body } = await getJsonApi(app, `/v1/release-groups/${publicIds.be}?include=releases`).expect(200);

      expect(body.data.attributes).toEqual(
        expect.objectContaining({
          releaseDate: { year: 2020, month: 11, day: 20 },
          upcoming: false,
          nextReleaseDate: { year: 2026, month: 11, day: 20 },
          releaseInstant: '2026-11-20T09:00:00.000Z',
        }),
      );
      expect(body.data.relationships.releases.data.map(({ id }: { id: string }) => id)).toEqual([publicIds.beStandard, publicIds.beDeluxe]);
    });

    it('ignores cancelled releases and shows a partial date without a countdown', async () => {
      const path = `/v1/release-groups/${publicIds.next}`;
      let { body } = await getJsonApi(app, path).expect(200);
      expect(body.data.attributes).toEqual(
        expect.objectContaining({ releaseDate: { year: 2026, month: 11, day: null }, upcoming: true, nextReleaseDate: { year: 2026, month: 11, day: null }, releaseInstant: null }),
      );

      app.clock.set('2026-11-01T00:00:00.000Z');
      ({ body } = await getJsonApi(app, path).expect(200));
      expect(body.data.attributes).toEqual(expect.objectContaining({ upcoming: false, nextReleaseDate: null }));
    });

    it('has no date while it has no dated release', async () => {
      for (const name of ['announced', 'undated']) {
        const { body } = await getJsonApi(app, `/v1/release-groups/${publicIds[name]}`).expect(200);
        expect(body.data.attributes).toEqual(expect.objectContaining({ releaseDate: null, upcoming: false, nextReleaseDate: null, releaseInstant: null }));
      }
    });
  });

  describe('lists', () => {
    it('lists published release groups by date, newest first and undated last', async () => {
      const { body } = await getJsonApi(app, '/v1/release-groups').expect(200);

      expect(ids(body)).toEqual([publicIds.next, publicIds.be, ...[publicIds.announced, publicIds.undated].sort()]);
      expect(body.meta.total).toBe(4);
    });

    it('filters upcoming release groups, soonest first', async () => {
      const upcoming = await getJsonApi(app, '/v1/release-groups?filter[upcoming]=true&sort=releaseDate').expect(200);
      expect(ids(upcoming.body)).toEqual([publicIds.next]);
      const past = await getJsonApi(app, '/v1/release-groups?filter[upcoming]=false&filter[type]=album').expect(200);
      expect(ids(past.body)).toEqual([publicIds.be]);
    });

    it('filters by a date range that a partial date overlaps', async () => {
      const groups = await getJsonApi(app, '/v1/release-groups?filter[releasedFrom]=2026-11-15&filter[releasedTo]=2026-12').expect(200);
      expect(ids(groups.body)).toEqual([publicIds.next]);
      const releases = await getJsonApi(app, '/v1/releases?filter[releasedFrom]=2026-11-15&filter[releasedTo]=2026').expect(200);
      expect(ids(releases.body)).toEqual([publicIds.beDeluxe, publicIds.nextStandard]);
    });

    it('filters releases by availability and release group', async () => {
      const availability = async (state: string) => ids((await getJsonApi(app, `/v1/releases?filter[availability]=${state}`).expect(200)).body);

      expect(await availability('cancelled')).toEqual([publicIds.nextJapan]);
      expect(await availability('unknown')).toEqual([publicIds.undatedStandard]);
      expect(await availability('upcoming')).toEqual([publicIds.beDeluxe, publicIds.nextStandard]);
      expect(await availability('released')).toEqual([publicIds.goneStandard, publicIds.beStandard]);
      const ofGroup = await getJsonApi(app, `/v1/releases?filter[releaseGroup]=${publicIds.be}&sort=title`).expect(200);
      expect(ofGroup.body.data).toHaveLength(2);
      const searched = await getJsonApi(app, '/v1/releases?filter[q]=remixes').expect(200);
      expect(ids(searched.body)).toEqual([publicIds.undatedStandard]);
    });

    it('lists the releases of a release group', async () => {
      const { body } = await getJsonApi(app, `/v1/release-groups/${publicIds.next}/releases?sort=releaseDate`).expect(200);
      expect(ids(body)).toEqual([publicIds.nextJapan, publicIds.nextStandard]);
    });

    it('refuses malformed filters', async () => {
      for (const query of [
        'filter[upcoming]=yes',
        'filter[releasedFrom]=2026-13',
        'filter[releasedTo]=26',
        'filter[type]=mixtape',
        'sort=popularity',
        'include=tracks',
      ]) {
        await getJsonApi(app, `/v1/release-groups?${query}`).expect(400);
      }
      await getJsonApi(app, '/v1/releases?filter[availability]=soon').expect(400);
    });
  });

  describe('discographies', () => {
    it('lists the release groups an artist presents, one per group', async () => {
      const identity = await getJsonApi(app, `/v1/identities/${publicIds.bts}`).expect(200);
      const artist = identity.body.data.relationships.artist.data.id;

      const { body } = await getJsonApi(app, `/v1/artists/${artist}/release-groups?include=artistCredits.artist`).expect(200);

      expect(ids(body)).toEqual([publicIds.be]);
      expect(body.included.map(({ type }: { type: string }) => type).sort()).toEqual(['artists', 'release-artist-credits']);
      await getJsonApi(app, '/v1/artists/unknown/release-groups').expect(404);
    });
  });

  describe('withdrawn and missing release groups', () => {
    it('shows only the notice of a withdrawn release group, which its releases still point to', async () => {
      const { body } = await getJsonApi(app, `/v1/release-groups/${publicIds.gone}`).expect(200);
      expect(body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect(body.data.relationships).toBeUndefined();

      const edition = await getJsonApi(app, `/v1/releases/${publicIds.goneStandard}?include=releaseGroup`).expect(200);
      expect(edition.body.data.attributes.displayTitle).toBeNull();
      expect(edition.body.included[0].attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect((await getJsonApi(app, `/v1/release-groups/${publicIds.gone}/releases`).expect(200)).body.data).toEqual([]);
    });

    it('answers 404 for a release group or release that does not exist', async () => {
      await getJsonApi(app, '/v1/release-groups/unknown').expect(404);
      await getJsonApi(app, '/v1/releases/unknown').expect(404);
      await getJsonApi(app, '/v1/release-groups/unknown/repackages').expect(404);
    });
  });
});
