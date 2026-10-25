import { queryTestDatabase, runPnpm } from '../support/console';
import { TestApp, createTestApp } from '../support/test-app';

jest.setTimeout(120_000);

const countries = () => queryTestDatabase<{ code: string; name: string }>('SELECT code, name FROM countries ORDER BY code');

describe('pnpm countries:load', () => {
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

  it('loads every ISO 3166-1 code plus Kosovo, territories included, with their common English names', async () => {
    const result = await runPnpm(['countries:load']);

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/Inserted 250 countries/);
    const loaded = await countries();
    expect(loaded).toHaveLength(250);
    expect(loaded).toEqual(
      expect.arrayContaining([
        { code: 'KR', name: 'South Korea' },
        { code: 'PR', name: 'Puerto Rico' },
        { code: 'HK', name: 'Hong Kong' },
        { code: 'TW', name: 'Taiwan' },
        { code: 'PS', name: 'Palestine' },
        { code: 'XK', name: 'Kosovo' },
        { code: 'AQ', name: 'Antarctica' },
      ]),
    );
  });

  it('skips a code already there, keeping its name, and inserts the rest', async () => {
    await queryTestDatabase(`INSERT INTO countries (code, name) VALUES ('KR', 'Corea del Sur')`);

    const result = await runPnpm(['countries:load']);

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/Inserted 249 countries/);
    expect(result.output).toMatch(/Skipped 1 whose code already exists: KR\./);
    const loaded = await countries();
    expect(loaded).toHaveLength(250);
    expect(loaded).toContainEqual({ code: 'KR', name: 'Corea del Sur' });
  });

  it('warns about a country named like a listed one with another code, without stopping', async () => {
    // Afghanistan saved by mistake under AG, the code of Antigua and Barbuda.
    await queryTestDatabase(`INSERT INTO countries (code, name) VALUES ('AG', 'afghanistán')`);

    const result = await runPnpm(['countries:load']);

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/Check the code of AG "afghanistán": the list gives that name to AF\./);
    expect(await countries()).toEqual(
      expect.arrayContaining([
        { code: 'AF', name: 'Afghanistan' },
        { code: 'AG', name: 'afghanistán' },
      ]),
    );
  });

  it('inserts nothing when run again', async () => {
    await runPnpm(['countries:load']);

    const result = await runPnpm(['countries:load']);

    expect(result).toMatchObject({ status: 0 });
    expect(result.output).toMatch(/Inserted 0 countries\.\nSkipped 250 whose code already exists/);
    expect(await countries()).toHaveLength(250);
  });
});
