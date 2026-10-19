import { SEED_PASSWORD } from '../../src/seed/seed-accounts';
import { accessTokenFor } from '../support/accounts';
import { CommandResult, queryTestDatabase, runPnpm } from '../support/console';
import { getJsonApi } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

jest.setTimeout(600_000);

/** Points the development commands at the test database. */
const asDevelopment = () => ({ NODE_ENV: 'development', DATABASE_URL: process.env.DATABASE_URL_TEST! });

const accountCount = async () => Number((await queryTestDatabase<{ n: string }>('SELECT count(*) AS n FROM users'))[0].n);

interface Resource {
  type: string;
  id: string;
  attributes: Record<string, any>;
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] | null }>;
}

describe('pnpm db:seed', () => {
  let app: TestApp;
  let seed: CommandResult;

  async function identityNamed(name: string): Promise<string> {
    const response = await getJsonApi(app, `/v1/identities?filter[q]=${encodeURIComponent(name)}`).expect(200);
    const identity = response.body.data.find(({ attributes }: Resource) => attributes.displayName === name);
    if (!identity) throw new Error(`No identity is named ${name}`);
    return identity.id;
  }

  async function workTitled(title: string): Promise<string> {
    const response = await getJsonApi(app, `/v1/works?filter[q]=${encodeURIComponent(title)}`).expect(200);
    const work = response.body.data.find(({ attributes }: Resource) => attributes.title === title);
    if (!work) throw new Error(`No work is titled ${title}`);
    return work.id;
  }

  /** The members of an organization, by display name, with their status and role slugs. */
  async function members(organizationId: string) {
    const response = await getJsonApi(
      app,
      `/v1/identities/${organizationId}/memberships?filter[side]=organization&include=member,roles.role&page[size]=100`,
    ).expect(200);
    const included = new Map<string, Resource>(response.body.included.map((each: Resource) => [`${each.type}:${each.id}`, each]));
    const linked = (data: { type: string; id: string }) => included.get(`${data.type}:${data.id}`)!;
    return response.body.data
      .map((membership: Resource) => ({
        member: linked(membership.relationships!.member.data as { type: string; id: string }).attributes.displayName,
        status: membership.attributes.status,
        roles: (membership.relationships!.roles.data as { type: string; id: string }[])
          .map((role) => linked(linked(role).relationships!.role.data as { type: string; id: string }).attributes.slug)
          .sort(),
      }))
      .sort((a: { member: string }, b: { member: string }) => a.member.localeCompare(b.member));
  }

  beforeAll(async () => {
    expect(await runPnpm(['db:reset'], asDevelopment())).toMatchObject({ status: 0 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['production', 'test'])('refuses to run when NODE_ENV is %s', async (environment) => {
    const result = await runPnpm(['db:seed'], { ...asDevelopment(), NODE_ENV: environment });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/only in development/);
    expect(await accountCount()).toBe(0);
  });

  describe('after db:reset', () => {
    beforeAll(async () => {
      seed = await runPnpm(['db:seed'], asDevelopment());
      app = await createTestApp();
    });

    it('completes', () => {
      expect(seed).toMatchObject({ status: 0 });
    });

    it('creates accounts of each role and status, among them the seed moderator', async () => {
      const admin = await accessTokenFor(app.server, 'seed_admin', SEED_PASSWORD);

      const response = await getJsonApi(app, '/v1/admin/users?page[size]=100&sort=username', admin).expect(200);

      const accounts = response.body.data.map(({ attributes }: { attributes: Record<string, unknown> }) => [
        attributes.username,
        attributes.role,
        attributes.status,
        attributes.emailVerified,
      ]);
      expect(accounts).toEqual(
        expect.arrayContaining([
          ['seed_admin', 'admin', 'active', true],
          ['seed_moderadora', 'moderator', 'active', true],
          ['seed_editora', 'user', 'active', true],
          ['seed_sin_verificar', 'user', 'active', false],
          ['seed_suspendida', 'user', 'suspended', true],
          ['seed_eliminada', 'user', 'deleted', true],
        ]),
      );
    });

    it('completes the editorial flow: microchanges in every status, each applied one with its decision and revision, all with real sources', async () => {
      const statuses = await queryTestDatabase<{ status: string }>('SELECT DISTINCT status::text FROM proposal_changes ORDER BY 1');
      expect(statuses.map(({ status }) => status)).toEqual(['applied', 'blocked', 'conflicted', 'pending', 'rejected', 'satisfied', 'withdrawn']);
      // The rejected duplicate stays a reservation; an administrator withdrew a concert published twice.
      const publication = await queryTestDatabase<{ status: string }>('SELECT DISTINCT publication_status::text AS status FROM editorial_entities ORDER BY 1');
      expect(publication.map(({ status }) => status)).toEqual(['published', 'reserved', 'withdrawn']);
      const [counts] = await queryTestDatabase<Record<string, number>>(`
        SELECT (SELECT count(*)::int FROM proposal_changes WHERE status = 'applied') AS applied,
               (SELECT count(*)::int FROM change_decisions WHERE action IN ('apply', 'apply_rebased')) AS decisions,
               (SELECT count(*)::int FROM entity_revisions) AS revisions,
               (SELECT count(*)::int FROM proposal_changes c
                 WHERE c.status <> 'pending' AND NOT EXISTS (SELECT 1 FROM change_decisions d WHERE d.change_id = c.id)) AS undecided,
               (SELECT count(*)::int FROM change_proposals p
                 WHERE NOT EXISTS (SELECT 1 FROM proposal_sources s WHERE s.proposal_id = p.id)) AS unsourced,
               (SELECT count(*)::int FROM proposal_sources WHERE url IS NULL OR url !~ '^https://') AS non_web_sources
      `);
      expect(counts).toEqual({
        applied: counts.decisions,
        decisions: counts.revisions,
        revisions: expect.any(Number),
        undecided: 0,
        unsourced: 0,
        non_web_sources: 0,
      });
      expect(counts.applied).toBeGreaterThan(600);
      // Contributors submit for review and staff publish directly; the suspended and deleted accounts contributed before.
      const authors = await queryTestDatabase<{ username: string }>(
        'SELECT DISTINCT u.username FROM change_proposals p JOIN users u ON u.id = p.author_id ORDER BY 1',
      );
      expect(authors.map(({ username }) => username)).toEqual([
        'seed_admin',
        'seed_colaborador',
        'seed_editora',
        'seed_eliminada',
        'seed_moderadora',
        'seed_suspendida',
      ]);
      const moderator = await accessTokenFor(app.server, 'seed_moderadora', SEED_PASSWORD);
      const queue = (await getJsonApi(app, '/v1/moderation/changes', moderator).expect(200)).body.data;
      expect(queue.map(({ attributes }: Resource) => attributes.status).sort()).toEqual(['conflicted', 'pending']);
    });

    it('creates releases with several editions, tracks and credits, repackages, announcements and cancelled editions', async () => {
      const group = async (title: string) => {
        const response = await getJsonApi(app, `/v1/release-groups?filter[q]=${encodeURIComponent(title)}&include=releases`).expect(200);
        const found = response.body.data.find(({ attributes }: Resource) => attributes.title === title);
        if (!found) throw new Error(`No release group is titled ${title}`);
        const releases = response.body.included.filter(
          ({ type, id }: Resource) => type === 'releases' && (found.relationships!.releases.data as { id: string }[]).some((each) => each.id === id),
        );
        return { group: found as Resource, releases: releases as Resource[] };
      };
      const edition = (releases: Resource[], name: string | null) => releases.find(({ attributes }) => attributes.editionName === name)!;
      const trackTitles = async (release: Resource) =>
        (await getJsonApi(app, `/v1/releases/${release.id}/tracks?page[size]=100`).expect(200)).body.data.map(
          ({ attributes }: Resource) => attributes.displayTitle,
        );

      const ruby = await group('Ruby');
      expect(ruby.releases.map(({ attributes }) => attributes.editionName).sort()).toEqual(['Clean', 'The Complete Collection', null].sort());
      expect(await trackTitles(edition(ruby.releases, null))).toHaveLength(15);
      expect(await trackTitles(edition(ruby.releases, 'Clean'))).not.toContain('F.T.S.');
      expect(await trackTitles(edition(ruby.releases, 'The Complete Collection'))).toHaveLength(21);
      const handlebars = await getJsonApi(app, `/v1/releases/${edition(ruby.releases, null).id}/tracks?include=artistCredits&page[size]=100`).expect(200);
      expect(handlebars.body.included.filter(({ type, attributes }: Resource) => type === 'track-artist-credits' && attributes.rank === 'featured')).toHaveLength(6);

      const cupid = await group('Cupid');
      expect(await trackTitles(edition(cupid.releases, 'Sped Up'))).toEqual(['Cupid (Twin Ver.) (Sped Up)']);
      // The bonus tracks first, then the album with the original «Energetic» moved to the end.
      expect(await trackTitles(edition((await group('BoA')).releases, 'Deluxe'))).toEqual([
        'Energetic (Radio Edit)',
        'Control',
        'Crazy About',
        'I Did It for Love',
        'Did Ya',
        "Look Who's Talking",
        'Eat You Up',
        'Obsessed',
        'Touched',
        'Scream',
        'Girls on Top',
        'Dress Off',
        'Hypnotic Dancefloor',
        'Energetic',
      ]);
      expect((await group('Twicecoaster: Lane 1')).releases.map(({ attributes }) => attributes.editionName)).toContain('Thailand Edition');

      const bornPink = edition((await group('Born Pink')).releases, null);
      const credits = await getJsonApi(app, `/v1/releases/${bornPink.id}?include=contributions.identity`).expect(200);
      expect(credits.body.included.filter(({ type }: Resource) => type === 'identities').map(({ attributes }: Resource) => attributes.displayName)).toEqual(['Teddy']);
      expect(await trackTitles(bornPink)).toContain('Shut Down');

      const lane2 = await group('Twicecoaster: Lane 2');
      const original = await getJsonApi(app, `/v1/release-groups/${lane2.group.id}?include=repackageOf`).expect(200);
      expect(original.body.included.map(({ attributes }: Resource) => attributes.title)).toEqual(['Twicecoaster: Lane 1']);

      // The announced time and zone give the instant a countdown goes to while it is still to come.
      const toUs = edition((await group('To Us')).releases, null);
      expect(toUs.attributes).toMatchObject({ releaseTime: '18:00', timezone: 'Asia/Seoul', releaseInstant: '2026-11-02T09:00:00.000Z' });
      expect(edition((await group('Perfect Storm')).releases, null).attributes).toMatchObject({ releaseTime: null, releaseInstant: null });

      // Announced for 9 November 2011 and halted by Avex before it came out.
      const cancelled = edition((await group('OH YEAH feat BOM (from 2NE1)')).releases, null);
      expect(cancelled.attributes).toMatchObject({ isCancelled: true, availability: 'cancelled', releaseInstant: null });
      expect(await trackTitles(cancelled)).toEqual(['OH YEAH feat BOM (from 2NE1)', 'HIGH HIGH']);
      expect((await group('Fake Love/Airplane pt.2')).releases.map(({ attributes }) => attributes.isCancelled)).toEqual([false]);
    });

    it('creates tours and concerts with their artists, organizers and links, and a schedule that changed', async () => {
      const tour = async (title: string) => {
        const response = await getJsonApi(app, `/v1/tours?filter[q]=${encodeURIComponent(title)}&include=organizers.identity,links,events,artists`).expect(200);
        const found = response.body.data.find(({ attributes }: Resource) => attributes.title === title);
        if (!found) throw new Error(`No tour is titled ${title}`);
        return { tour: found as Resource, included: response.body.included as Resource[] };
      };

      const bornPink = await tour('Born Pink World Tour');
      expect(bornPink.tour.attributes.status).toBe('completed');
      const organizers = bornPink.included.filter(({ type }) => type === 'identities').map(({ attributes }) => attributes.displayName);
      expect(organizers.sort()).toEqual(['Live Nation Entertainment', 'YG Entertainment']);
      expect(bornPink.included.filter(({ type }) => type === 'tour-links').map(({ attributes }) => attributes.url)).toEqual(['https://www.blackpinkmusic.com/']);
      const concerts = bornPink.included.filter(({ type }) => type === 'events').map(({ attributes }) => [attributes.city, attributes.status]);
      expect(concerts).toContainEqual(['Auckland', 'cancelled']);
      expect(concerts.filter(([, status]) => status === 'performed')).toHaveLength(4);

      // Created as scheduled and cancelled by a later proposal, which keeps the date.
      const mapOfTheSoul = await tour('Map of the Soul Tour');
      expect(mapOfTheSoul.tour.attributes).toMatchObject({ status: 'cancelled', startDate: { year: 2020, month: 4, day: 11 } });
      expect(new Set(mapOfTheSoul.included.filter(({ type }) => type === 'events').map(({ attributes }) => attributes.status))).toEqual(new Set(['cancelled']));

      // The withdrawn copy of a concert is not listed among the tour's concerts.
      const stealTheWind = await tour('Steal the Wind');
      expect(stealTheWind.included.filter(({ type }) => type === 'events')).toHaveLength(3);
    });

    it('creates groups with their members, roles, former members and subunits', async () => {
      const blackpink = await identityNamed('BLACKPINK');
      expect(await members(blackpink)).toEqual([
        { member: 'Jennie', status: 'current', roles: ['rapper', 'vocalist'] },
        { member: 'Jisoo', status: 'current', roles: ['vocalist'] },
        { member: 'Lisa', status: 'current', roles: ['dancer', 'rapper', 'vocalist'] },
        { member: 'Rosé', status: 'current', roles: ['dancer', 'vocalist'] },
      ]);

      const bigbang = await identityNamed('BIGBANG');
      expect(await members(bigbang)).toEqual(
        expect.arrayContaining([
          { member: 'T.O.P', status: 'former', roles: ['rapper'] },
          { member: 'Seungri', status: 'former', roles: ['vocalist'] },
          { member: 'GD & TOP', status: 'current', roles: [] },
        ]),
      );
      expect(await members(await identityNamed('TWICE'))).toContainEqual({ member: 'MISAMO', status: 'current', roles: [] });
    });

    it('creates artists affiliated with their agencies', async () => {
      const response = await getJsonApi(app, '/v1/artists?filter[q]=BLACKPINK&include=identity,affiliations.organization').expect(200);

      const organizations = response.body.included
        .filter(({ type, attributes }: Resource) => type === 'identities' && attributes.type === 'organization')
        .map(({ attributes }: Resource) => attributes.displayName);
      expect(organizations).toContain('YG Entertainment');
    });

    it('creates works with their authors and the recordings that perform or sample them', async () => {
      const dynamite = await workTitled('Dynamite');
      const credited = (await getJsonApi(app, `/v1/works/${dynamite}?include=contributions.identity`).expect(200)).body.included
        .filter(({ type }: Resource) => type === 'identities')
        .map(({ attributes }: Resource) => attributes.displayName);
      expect(credited.sort()).toEqual(['David Stewart', 'Jessica Agombar']);

      const campanella = await workTitled('La Campanella');
      const sampling = await getJsonApi(app, `/v1/works/${campanella}/recordings?filter[relationType]=sample`).expect(200);
      expect(sampling.body.data.map(({ attributes }: Resource) => attributes.title)).toEqual(['Shut Down']);
    });

    it('refuses to seed a database that already has data', async () => {
      const accountsBefore = await accountCount();

      const result = await runPnpm(['db:seed'], asDevelopment());

      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/db:reset/);
      expect(await accountCount()).toBe(accountsBefore);
    });
  });
});
