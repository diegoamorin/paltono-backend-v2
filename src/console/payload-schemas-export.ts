import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { registeredOperations, operationId, payloadSchema } from '../editorial/operation-registry';
import { runCommand } from './run-command';

// `pnpm payload-schemas:export [path]`: adds each newly published payload schema version to `payload-schemas.json`
// by default. A published version never changes (ADR 0006), so an entry already there that the registry now
// describes differently fails the command and leaves the file as it was: publish a new version instead.
runCommand(async () => {
  const path = resolve(process.argv[2] ?? 'payload-schemas.json');
  const frozen: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));

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
    throw new Error(`Published payload schema versions changed or disappeared: ${changed.join(', ')}. Publish a new version instead.`);
  }

  const added = Object.keys(published).filter((id) => !(id in frozen));
  const all: Record<string, unknown> = { ...frozen, ...published };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((id) => [id, all[id]]));
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
  return `Wrote ${path}: ${added.length} new version(s)`;
});
