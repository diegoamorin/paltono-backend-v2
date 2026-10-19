import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabaseUrl } from '../../src/database/test-database-url';

const env = (url: string) => ({ DATABASE_URL_TEST: url });

describe('testDatabaseUrl', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paltono-checkout-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A linked git worktree: `.git` is a file pointing into the main repository's `worktrees/<name>`. */
  function linkedWorktree(name: string): string {
    const checkout = join(root, 'checkout');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    writeFileSync(join(checkout, '.git'), `gitdir: F:/repo/.git/worktrees/${name}\n`);
    return checkout;
  }

  it('keeps DATABASE_URL_TEST unchanged in the main checkout', () => {
    mkdirSync(join(root, '.git'));

    expect(testDatabaseUrl(env('postgres://u:p@localhost:5432/paltono_test'), root)).toBe(
      'postgres://u:p@localhost:5432/paltono_test',
    );
  });

  it('suffixes the database name with the worktree name in a linked worktree', () => {
    const checkout = linkedWorktree('agent-A1b2');

    expect(testDatabaseUrl(env('postgres://u:p@localhost:5432/paltono_test?sslmode=disable'), checkout)).toBe(
      'postgres://u:p@localhost:5432/paltono_agent_a1b2_test?sslmode=disable',
    );
  });

  it('finds the worktree from a directory inside it', () => {
    const checkout = linkedWorktree('feature');

    expect(testDatabaseUrl(env('postgres://localhost/paltono_test'), join(checkout, 'src'))).toBe(
      'postgres://localhost/paltono_feature_test',
    );
  });

  it('does not suffix a URL already suffixed for the worktree, so child commands agree', () => {
    const checkout = linkedWorktree('feature');

    expect(testDatabaseUrl(env('postgres://localhost/paltono_feature_test'), checkout)).toBe(
      'postgres://localhost/paltono_feature_test',
    );
  });

  it('shortens a long worktree name so the database name fits in 63 bytes and stays distinct', () => {
    const long = 'a-very-long-worktree-name-that-would-push-the-database-name-past-the-limit';
    const first = testDatabaseUrl(env('postgres://localhost/paltono_test'), linkedWorktree(`${long}-one`))!;
    rmSync(join(root, 'checkout'), { recursive: true });
    const second = testDatabaseUrl(env('postgres://localhost/paltono_test'), linkedWorktree(`${long}-two`))!;

    for (const url of [first, second]) {
      const database = new URL(url).pathname.slice(1);
      expect(database).toMatch(/^paltono_a_very_long_worktree_name_[a-z0-9_]+_test$/);
      expect(database.length).toBeLessThanOrEqual(63);
    }
    expect(first).not.toBe(second);
  });

  it('leaves a name not ending in _test for the safety checks to reject', () => {
    const checkout = linkedWorktree('feature');

    expect(testDatabaseUrl(env('postgres://localhost/paltono_dev'), checkout)).toBe('postgres://localhost/paltono_dev');
  });

  it('returns undefined when DATABASE_URL_TEST is not set', () => {
    expect(testDatabaseUrl({}, root)).toBeUndefined();
  });
});
