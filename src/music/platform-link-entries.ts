import { EntityManager, In } from 'typeorm';
import { RecordingPlatformLink } from './entities/recording.entity';
import { RecordingEntry } from './music.resource';
import { isWithdrawn } from './resource-primitives';

/**
 * Recording entries with their platform links (ADR 0009), for a recording
 * read on its own or as the recording of a track; a withdrawn recording does
 * not show them.
 */
export async function withPlatformLinks(manager: EntityManager, entries: RecordingEntry[]): Promise<RecordingEntry[]> {
  const shown = entries.map(({ recording }) => recording).filter((recording) => !isWithdrawn(recording));
  if (shown.length === 0) return entries;
  const links = await manager.find(RecordingPlatformLink, {
    where: { recordingId: In(shown.map(({ id }) => id)) },
    relations: { platform: true },
    order: { platformId: 'ASC' },
  });
  return entries.map((entry) =>
    shown.includes(entry.recording)
      ? { ...entry, platformLinks: links.filter(({ recordingId }) => recordingId === entry.recording.id).map((link) => ({ link, recording: entry.recording })) }
      : entry,
  );
}
