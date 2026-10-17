import { DataSource } from 'typeorm';
import { register, setAccountStatus, verifyEmail } from '../support/accounts';
import { queryTestDatabase, runPnpm } from '../support/console';
import { TestApp, createTestApp } from '../support/test-app';

jest.setTimeout(120_000);

interface RoleChangeRow {
  username: string;
  changed_by: number | null;
  previous_role: string;
  new_role: string;
  reason: string;
}

const roleChanges = () =>
  queryTestDatabase<RoleChangeRow>(`
    SELECT u.username, c.changed_by, c.previous_role, c.new_role, c.reason
    FROM user_role_changes c JOIN users u ON u.id = c.user_id ORDER BY c.changed_at
  `);

const roleOf = async (username: string) =>
  (await queryTestDatabase<{ role: string }>(`SELECT role FROM users WHERE username = '${username}'`))[0]?.role;

// The command runs through a shell, so each argument is quoted to keep its spaces.
const bootstrap = (...args: string[]) => runPnpm(['admin:bootstrap', '--', ...args.map((arg) => `"${arg}"`)]);

describe('pnpm admin:bootstrap', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAccount(username: string, { verified = true } = {}) {
    const email = `${username}@example.com`;
    await register(app.server, { username, email }).expect(201);
    if (verified) await verifyEmail(app.server, app.mailer.lastToken(email, 'email-verification')).expect(204);
  }

  it('promotes an active verified account to administrator and audits it with no acting administrator', async () => {
    await registerAccount('diego_papi');

    const result = await bootstrap('--username', 'Diego_Papi', '--reason', 'Primer despliegue');

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/diego_papi is now an administrator/);
    expect(await roleOf('diego_papi')).toBe('admin');
    expect(await roleChanges()).toEqual([
      { username: 'diego_papi', changed_by: null, previous_role: 'user', new_role: 'admin', reason: 'Primer despliegue' },
    ]);
  });

  it.each([
    [['--username', 'diego_papi'], /--reason is required/],
    [['--username', 'diego_papi', '--reason', '   '], /--reason is required/],
    [['--reason', 'Primer despliegue'], /--username is required/],
  ])('requires a username and a reason (%j)', async (args, message) => {
    await registerAccount('diego_papi');

    const result = await bootstrap(...args);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(message);
    expect(await roleOf('diego_papi')).toBe('user');
    expect(await roleChanges()).toEqual([]);
  });

  it('refuses an unknown account', async () => {
    const result = await bootstrap('--username', 'nadie', '--reason', 'Primer despliegue');

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/No account has the username "nadie"/);
  });

  it('refuses an account whose email is not verified', async () => {
    await registerAccount('diego_papi', { verified: false });

    const result = await bootstrap('--username', 'diego_papi', '--reason', 'Primer despliegue');

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must have a verified email/);
    expect(await roleOf('diego_papi')).toBe('user');
  });

  it.each(['suspended', 'deleted'] as const)('refuses a %s account', async (status) => {
    await registerAccount('diego_papi');
    await setAccountStatus(app.app.get(DataSource), 'diego_papi', status);

    const result = await bootstrap('--username', 'diego_papi', '--reason', 'Primer despliegue');

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must be active/);
    expect(await roleChanges()).toEqual([]);
  });

  it('refuses once an administrator exists', async () => {
    await registerAccount('diego_papi');
    await registerAccount('otra');
    expect(await bootstrap('--username', 'diego_papi', '--reason', 'Primer despliegue')).toMatchObject({ status: 0 });

    const result = await bootstrap('--username', 'otra', '--reason', 'Otro intento');

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/An administrator already exists/);
    expect(await roleOf('otra')).toBe('user');
    expect(await roleChanges()).toHaveLength(1);
  });

  it('promotes at most one account when run twice at the same time', async () => {
    await registerAccount('diego_papi');
    await registerAccount('otra');

    const results = await Promise.all([
      bootstrap('--username', 'diego_papi', '--reason', 'Primer despliegue'),
      bootstrap('--username', 'otra', '--reason', 'Primer despliegue'),
    ]);

    expect(results.map((result) => result.status === 0).filter(Boolean)).toHaveLength(1);
    expect(await queryTestDatabase(`SELECT username FROM users WHERE role = 'admin'`)).toHaveLength(1);
    expect(await roleChanges()).toHaveLength(1);
  });
});
