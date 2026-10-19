import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { CommandResult, runPnpm } from '../support/console';
import { createTestApp } from '../support/test-app';

jest.setTimeout(120_000);

describe('pnpm openapi:export', () => {
  let directory: string;
  let exported: CommandResult;
  let file: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openapi-export-'));
    file = join(directory, 'openapi.json');
    exported = await runPnpm(['openapi:export', file]);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the OpenAPI document that the API serves at /docs-json', async () => {
    expect(exported).toMatchObject({ status: 0 });
    const app = await createTestApp({ env: { NODE_ENV: 'development' } });
    try {
      const { body: served } = await request(app.server).get('/docs-json').expect(200);

      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(served);
    } finally {
      await app.close();
    }
  });

  it('matches the committed openapi.json', async () => {
    expect(exported).toMatchObject({ status: 0 });
    const committed = await readFile(join(__dirname, '../../openapi.json'), 'utf8').catch(() => '');

    // A plain comparison: `expect` would print a diff of the whole 600 KB document instead of the fix.
    if (committed !== (await readFile(file, 'utf8'))) {
      throw new Error('openapi.json does not match the API; run `pnpm openapi:export` and commit it.');
    }
  });
});
