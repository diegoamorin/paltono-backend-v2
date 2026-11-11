import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveEntity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

const MINUTE = 60 * 1000;
const present = (value: unknown) => ({ exists: true, value });
const ids = (body: { data: { id: string }[] }) => body.data.map(({ id }) => id);

describe('releases (M11–M14), editions (M7, M8) and discographies (C8)', () => {
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

  const release = (name: string, title: string, type: string) => publishRoot(name, 'release', 'releases', { title, type });
  const edition = (name: string, releaseName: string, value: object = {}) =>
    publishRoot(name, 'edition', 'editions', { release: { entity_id: roots[releaseName] }, ...value });

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await publishRoot('bts', 'identity', 'catalog_identities', { type: 'organization', displayName: 'BTS', organization: {} });
    await publish([
      { entityId: roots.bts, operation: 'add_relation', targetPath: 'artists', targetKey: { catalog_identity_id: { entity_id: roots.bts } }, proposedValue: present({}) },
    ]);

    await release('be', 'BE', 'album');
    await edition('beStandard', 'be', { releaseDate: { year: 2020, month: 11, day: 20 }, releaseTime: '14:00', timezone: 'Asia/Seoul' });
    await edition('beDeluxe', 'be', { editionName: 'Deluxe', releaseDate: { year: 2026, month: 11, day: 20 }, releaseTime: '18:00', timezone: 'Asia/Seoul' });
    await publish([
      {
        entityId: roots.be,
        operation: 'add_relation',
        targetPath: 'release_artist_credits',
        targetKey: { release_id: { entity_id: roots.be }, artist_id: { entity_id: roots.bts } },
        proposedValue: present({ position: 0 }),
      },
    ]);

    await release('next', 'Next', 'ep');
    await edition('nextStandard', 'next', { releaseDate: { year: 2026, month: 11 } });
    await edition('nextJapan', 'next', { editionName: 'Japan Edition', releaseDate: { year: 2026, month: 10, day: 1 }, isCancelled: true });

    await release('announced', 'Announced', 'single');
    await release('undated', 'Undated', 'single');
    await edition('undatedStandard', 'undated', { title: 'Undated (Remixes)' });

    await release('gone', 'Gone', 'album');
    await edition('goneStandard', 'gone', { releaseDate: { year: 2021, month: 1, day: 1 } });
    await publish([{ entityId: roots.gone, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: present('withdrawn') }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => app.clock.set('2026-10-18T00:00:00.000Z'));

  describe('derived availability of an edition', () => {
    it('counts down to the instant of its time in its zone, and is released from that instant', async () => {
      const path = `/v1/editions/${publicIds.beDeluxe}`;
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
      const availability = async (name: string) => (await getJsonApi(app, `/v1/editions/${publicIds[name]}`).expect(200)).body.data.attributes.availability;

      expect(await availability('nextStandard')).toBe('upcoming');
      expect(await availability('nextJapan')).toBe('cancelled');
      expect(await availability('undatedStandard')).toBe('unknown');
      app.clock.set('2026-11-01T00:00:00.000Z');
      expect(await availability('nextStandard')).toBe('released');
    });
  });

  describe('derived dates of a release', () => {
    it('takes its date from its earliest edition and its countdown from the next one with an instant', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.be}?include=editions`).expect(200);

      expect(body.data.type).toBe('releases');
      expect(body.data.attributes).toEqual(
        expect.objectContaining({
          releaseDate: { year: 2020, month: 11, day: 20 },
          upcoming: false,
          nextReleaseDate: { year: 2026, month: 11, day: 20 },
          releaseInstant: '2026-11-20T09:00:00.000Z',
        }),
      );
      expect(body.data.relationships.editions.data.map(({ id }: { id: string }) => id)).toEqual([publicIds.beStandard, publicIds.beDeluxe]);
      expect(body.included.map(({ type }: { type: string }) => type)).toEqual(['editions', 'editions']);
    });

    it('ignores cancelled editions and shows a partial date without a countdown', async () => {
      const path = `/v1/releases/${publicIds.next}`;
      let { body } = await getJsonApi(app, path).expect(200);
      expect(body.data.attributes).toEqual(
        expect.objectContaining({ releaseDate: { year: 2026, month: 11, day: null }, upcoming: true, nextReleaseDate: { year: 2026, month: 11, day: null }, releaseInstant: null }),
      );

      app.clock.set('2026-11-01T00:00:00.000Z');
      ({ body } = await getJsonApi(app, path).expect(200));
      expect(body.data.attributes).toEqual(expect.objectContaining({ upcoming: false, nextReleaseDate: null }));
    });

    it('has no date while it has no dated edition', async () => {
      for (const name of ['announced', 'undated']) {
        const { body } = await getJsonApi(app, `/v1/releases/${publicIds[name]}`).expect(200);
        expect(body.data.attributes).toEqual(expect.objectContaining({ releaseDate: null, upcoming: false, nextReleaseDate: null, releaseInstant: null }));
      }
    });
  });

  describe('lists', () => {
    it('lists published releases by date, newest first and undated last', async () => {
      const { body } = await getJsonApi(app, '/v1/releases').expect(200);

      expect(ids(body)).toEqual([publicIds.next, publicIds.be, ...[publicIds.announced, publicIds.undated].sort((a, b) => a.localeCompare(b, 'und'))]);
      expect(body.meta.total).toBe(4);
    });

    it('filters upcoming releases, soonest first', async () => {
      const upcoming = await getJsonApi(app, '/v1/releases?filter[upcoming]=true&sort=releaseDate').expect(200);
      expect(ids(upcoming.body)).toEqual([publicIds.next]);
      const past = await getJsonApi(app, '/v1/releases?filter[upcoming]=false&filter[type]=album').expect(200);
      expect(ids(past.body)).toEqual([publicIds.be]);
    });

    it('filters by a date range that a partial date overlaps', async () => {
      const releases = await getJsonApi(app, '/v1/releases?filter[releasedFrom]=2026-11-15&filter[releasedTo]=2026-12').expect(200);
      expect(ids(releases.body)).toEqual([publicIds.next]);
      const editions = await getJsonApi(app, '/v1/editions?filter[releasedFrom]=2026-11-15&filter[releasedTo]=2026').expect(200);
      expect(ids(editions.body)).toEqual([publicIds.beDeluxe, publicIds.nextStandard]);
    });

    it('filters editions by availability and release', async () => {
      const availability = async (state: string) => ids((await getJsonApi(app, `/v1/editions?filter[availability]=${state}`).expect(200)).body);

      expect(await availability('cancelled')).toEqual([publicIds.nextJapan]);
      expect(await availability('unknown')).toEqual([publicIds.undatedStandard]);
      expect(await availability('upcoming')).toEqual([publicIds.beDeluxe, publicIds.nextStandard]);
      expect(await availability('released')).toEqual([publicIds.goneStandard, publicIds.beStandard]);
      const ofRelease = await getJsonApi(app, `/v1/editions?filter[release]=${publicIds.be}&sort=title`).expect(200);
      expect(ofRelease.body.data).toHaveLength(2);
      const searched = await getJsonApi(app, '/v1/editions?filter[q]=remixes').expect(200);
      expect(ids(searched.body)).toEqual([publicIds.undatedStandard]);
    });

    it('lists the editions of a release', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.next}/editions?sort=releaseDate`).expect(200);
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
        await getJsonApi(app, `/v1/releases?${query}`).expect(400);
      }
      await getJsonApi(app, '/v1/editions?filter[availability]=soon').expect(400);
    });
  });

  describe('discographies', () => {
    it('lists the releases an artist presents, one per release', async () => {
      const identity = await getJsonApi(app, `/v1/identities/${publicIds.bts}`).expect(200);
      const artist = identity.body.data.relationships.artist.data.id;

      const { body } = await getJsonApi(app, `/v1/artists/${artist}/releases?include=artistCredits.artist`).expect(200);

      expect(ids(body)).toEqual([publicIds.be]);
      expect(body.included.map(({ type }: { type: string }) => type).sort()).toEqual(['artists', 'release-artist-credits']);
      await getJsonApi(app, '/v1/artists/unknown/releases').expect(404);
    });
  });

  describe('withdrawn and missing releases', () => {
    it('shows only the notice of a withdrawn release, which its editions still point to', async () => {
      const { body } = await getJsonApi(app, `/v1/releases/${publicIds.gone}`).expect(200);
      expect(body.data.attributes).toEqual({ publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) });
      expect(body.data.relationships).toBeUndefined();

      const edition = await getJsonApi(app, `/v1/editions/${publicIds.goneStandard}?include=release`).expect(200);
      expect(edition.body.data.attributes.displayTitle).toBeNull();
      expect(edition.body.included[0]).toEqual(
        expect.objectContaining({ type: 'releases', attributes: { publicationStatus: 'withdrawn', withdrawnAt: expect.any(String) } }),
      );
      expect((await getJsonApi(app, `/v1/releases/${publicIds.gone}/editions`).expect(200)).body.data).toEqual([]);
    });

    it('answers 404 for a release or edition that does not exist', async () => {
      await getJsonApi(app, '/v1/releases/unknown').expect(404);
      await getJsonApi(app, '/v1/editions/unknown').expect(404);
      await getJsonApi(app, '/v1/releases/unknown/repackages').expect(404);
    });

    it('never serves an edition as a release, nor the old paths', async () => {
      await getJsonApi(app, `/v1/releases/${publicIds.beStandard}`).expect(404);
      await getJsonApi(app, `/v1/editions/${publicIds.be}`).expect(404);
      // The MusicBrainz name of a release is spelled in two parts, so the old name appears nowhere else (ADR 0010).
      const oldPath = `/v1/release${'-groups'}`;
      await getJsonApi(app, `${oldPath}/${publicIds.be}`).expect(404);
      await getJsonApi(app, oldPath).expect(404);
    });
  });
});
