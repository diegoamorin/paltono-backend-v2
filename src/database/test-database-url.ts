import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * The test database URL for the checkout at `cwd`: `DATABASE_URL_TEST` in the
 * main checkout, and in a linked git worktree the same URL with the worktree's
 * name inserted before `_test` (`paltono_test` → `paltono_<worktree>_test`), so
 * checkouts sharing one `.env` never destroy each other's database. A URL that
 * already carries the suffix is returned as is, so child commands that receive
 * it agree with their parent.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv, cwd = process.cwd()): string | undefined {
  const url = env.DATABASE_URL_TEST;
  const worktree = url && linkedWorktreeName(cwd);
  if (!worktree) return url;

  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) return url;

  const base = database.slice(0, -'_test'.length);
  const suffix = `_${fitWorktreeName(worktree, MAX_IDENTIFIER_BYTES - Buffer.byteLength(`${base}__test`))}_test`;
  if (database.endsWith(suffix)) return url;

  parsed.pathname = `/${encodeURIComponent(base + suffix)}`;
  return parsed.toString();
}

/** PostgreSQL silently truncates longer names, which would drop the `_test` ending. */
const MAX_IDENTIFIER_BYTES = 63;

/** The worktree name, or when longer than `room` its start plus a short hash of the whole name. */
function fitWorktreeName(worktree: string, room: number): string {
  if (worktree.length <= room) return worktree;
  const hash = createHash('sha1').update(worktree).digest('hex').slice(0, 8);
  return `${worktree.slice(0, Math.max(0, room - hash.length - 1))}_${hash}`;
}

/** The name of the linked worktree containing `cwd`, as a lowercase identifier; undefined in a main checkout. */
function linkedWorktreeName(cwd: string): string | undefined {
  for (let directory = cwd; ; directory = dirname(directory)) {
    const git = join(directory, '.git');
    if (existsSync(git)) {
      if (!statSync(git).isFile()) return undefined;
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, 'utf8'))?.[1].trim();
      // Submodules also have a `.git` file; only worktrees live under `.git/worktrees/`.
      if (!gitdir || basename(dirname(gitdir)) !== 'worktrees') return undefined;
      return basename(gitdir).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    }
    if (dirname(directory) === directory) return undefined;
  }
}
