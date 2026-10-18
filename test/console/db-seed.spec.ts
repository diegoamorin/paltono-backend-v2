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

    it('completes the editorial flow: every microchange applied, with its decision, revision and real sources', async () => {
      expect(await queryTestDatabase('SELECT status, count(*)::int AS n FROM proposal_changes GROUP BY status')).toEqual([
        { status: 'applied', n: expect.any(Number) },
      ]);
      expect(await queryTestDatabase(`SELECT DISTINCT publication_status FROM editorial_entities`)).toEqual([
        { publication_status: 'published' },
      ]);
      expect(await queryTestDatabase(`SELECT DISTINCT status FROM change_proposals`)).toEqual([{ status: 'closed' }]);
      const [counts] = await queryTestDatabase<Record<string, number>>(`
        SELECT (SELECT count(*)::int FROM proposal_changes) AS changes,
               (SELECT count(*)::int FROM change_decisions WHERE action = 'apply') AS decisions,
               (SELECT count(*)::int FROM entity_revisions) AS revisions,
               (SELECT count(*)::int FROM change_proposals p
                 WHERE NOT EXISTS (SELECT 1 FROM proposal_sources s WHERE s.proposal_id = p.id)) AS unsourced,
               (SELECT count(*)::int FROM proposal_sources WHERE url IS NULL OR url !~ '^https://') AS non_web_sources
      `);
      expect(counts).toEqual({
        changes: counts.decisions,
        decisions: counts.revisions,
        revisions: expect.any(Number),
        unsourced: 0,
        non_web_sources: 0,
      });
      expect(counts.changes).toBeGreaterThan(300);
      // Contributors submit for review and the moderator publishes directly; the suspended and deleted accounts contributed before.
      const authors = await queryTestDatabase<{ username: string }>(
        'SELECT DISTINCT u.username FROM change_proposals p JOIN users u ON u.id = p.author_id ORDER BY 1',
      );
      expect(authors.map(({ username }) => username)).toEqual([
        'seed_colaborador',
        'seed_editora',
        'seed_eliminada',
        'seed_moderadora',
        'seed_suspendida',
      ]);
      const moderator = await accessTokenFor(app.server, 'seed_moderadora', SEED_PASSWORD);
      expect((await getJsonApi(app, '/v1/moderation/changes', moderator).expect(200)).body.data).toEqual([]);
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
