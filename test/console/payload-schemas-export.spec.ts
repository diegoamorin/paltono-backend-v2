import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPnpm } from '../support/console';

jest.setTimeout(120_000);

const COMMITTED = join(__dirname, '../../payload-schemas.json');
const CREATION = 'identity.create_entity.catalog_identities.v1';

type Schemas = Record<string, { payloadSchema: object; targetKeySchema: object | null }>;

describe('pnpm payload-schemas:export', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'payload-schemas-'));
    file = join(directory, 'payload-schemas.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const read = async (path: string): Promise<Schemas> => JSON.parse(await readFile(path, 'utf8'));

  it('matches the committed payload-schemas.json', async () => {
    await copyFile(COMMITTED, file).catch(() => writeFile(file, '{}\n'));

    const exported = await runPnpm(['payload-schemas:export', file]);

    expect(exported).toMatchObject({ status: 0 });
    if ((await readFile(COMMITTED, 'utf8').catch(() => '')) !== (await readFile(file, 'utf8'))) {
      throw new Error('payload-schemas.json lacks a published version; run `pnpm payload-schemas:export` and commit it.');
    }
  });

  it('adds a newly published version and keeps the others', async () => {
    const { [CREATION]: added, ...others } = await read(COMMITTED);
    await writeFile(file, JSON.stringify(others));

    expect(await runPnpm(['payload-schemas:export', file])).toMatchObject({ status: 0 });

    expect(await read(file)).toEqual({ ...others, [CREATION]: added });
  });

  it('refuses to change the schemas of a published version, leaving the file as it was', async () => {
    const committed = await read(COMMITTED);
    const tampered = JSON.stringify({ ...committed, [CREATION]: { ...committed[CREATION], targetKeySchema: { type: 'object' } } });
    await writeFile(file, tampered);

    const exported = await runPnpm(['payload-schemas:export', file]);

    expect(exported.status).toBe(1);
    expect(exported.output).toContain(CREATION);
    expect(await readFile(file, 'utf8')).toBe(tampered);
  });

  it('regenerates the schemas of a version already written when asked to explicitly', async () => {
    const committed = await read(COMMITTED);
    await writeFile(file, JSON.stringify({ ...committed, [CREATION]: { ...committed[CREATION], targetKeySchema: { type: 'object' } } }));

    const exported = await runPnpm(['payload-schemas:export', '--regenerate', file]);

    expect(exported).toMatchObject({ status: 0 });
    expect(await readFile(file, 'utf8')).toBe(await readFile(COMMITTED, 'utf8'));
  });
});
