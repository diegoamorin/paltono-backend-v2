import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { registeredOperations, operationId, payloadSchema } from '../editorial/operation-registry';
import { runCommand } from './run-command';

// `pnpm payload-schemas:export [--regenerate] [path]`: adds each newly published payload schema version to
// `payload-schemas.json` by default. A published version never changes (ADR 0006), so an entry already there that
// the registry now describes differently fails the command and leaves the file as it was: publish a new version
// instead. Until the first deployment nothing is published yet and v1 changes in place: `--regenerate` rewrites
// the file with exactly what the registry describes now.
runCommand(async () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { regenerate: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const path = resolve(positionals[0] ?? 'payload-schemas.json');
  const frozen: Record<string, unknown> = values.regenerate ? {} : JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));

  // Through JSON, so the comparison sees exactly what the file holds.
  const published: Record<string, unknown> = JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        registeredOperations().map((entry) => [operationId(entry), { payloadSchema: payloadSchema(entry), targetKeySchema: entry.targetKeySchema }]),
      ),
    ),
  );
  const changed = Object.keys(frozen).filter((id) => !isDeepStrictEqual(frozen[id], published[id]));
  if (changed.length > 0) {
    throw new Error(
      `Published payload schema versions changed or disappeared: ${changed.join(', ')}. Publish a new version instead, ` +
        'or, before the first deployment, regenerate them with --regenerate.',
    );
  }

  const added = Object.keys(published).filter((id) => !(id in frozen));
  const all: Record<string, unknown> = { ...frozen, ...published };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((id) => [id, all[id]]));
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
  return values.regenerate ? `Regenerated ${path}: ${added.length} version(s)` : `Wrote ${path}: ${added.length} new version(s)`;
});
