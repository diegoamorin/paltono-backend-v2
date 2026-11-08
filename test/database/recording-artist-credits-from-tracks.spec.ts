import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { databaseOptions } from '../../src/database/database-options';
import { CreditRecordingsFromTracks1793448000000 } from '../../src/database/migrations/1793448000000-CreditRecordingsFromTracks';
import { currentTestDatabaseUrl } from '../support/console';

type Credit = { artist: number; rank: string; position: number; creditedAs: string | null };
type Release = { status: 'published' | 'reserved' | 'withdrawn'; cancelled?: boolean; date?: [number?, number?, number?] };

/*
 * The API cannot observe a migration, so this goes to the database: inside a
 * transaction it steps down to the state before the migration, inserts
 * recordings, releases and tracks with credits and steps up. The rollback
 * leaves the shared test database as it was.
 */
describe('migration CreditRecordingsFromTracks', () => {
  const migration = new CreditRecordingsFromTracks1793448000000();
  let dataSource: DataSource;
  let runner: QueryRunner;
  let userId: number;
  let proposalId: string;
  let becky: number;
  let natti: number;
  let jennie: number;

  beforeAll(async () => {
    dataSource = await new DataSource(databaseOptions(currentTestDatabaseUrl())).initialize();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    await migration.down(runner);
    [{ id: userId }] = await runner.query(
      `INSERT INTO users (uuid, username, email, display_name, created_at, updated_at, username_changed_at)
       VALUES ($1, 'autora', 'autora@example.com', 'Autora', now(), now(), now()) RETURNING id`,
      [randomUUID()],
    );
    proposalId = randomUUID();
    await runner.query(
      `INSERT INTO change_proposals (id, author_id, description, status, created_at, updated_at, submitted_at, closed_at)
       VALUES ($1, $2, 'Catálogo', 'closed', now(), now(), now(), now())`,
      [proposalId, userId],
    );
    becky = await insertArtist();
    natti = await insertArtist();
    jennie = await insertArtist();
  });

  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  let changePosition = 0;

  /** An editorial root, published through an applied creation when asked. */
  async function insertRoot(type: string, status: Release['status'] = 'published'): Promise<string> {
    const entityId = randomUUID();
    await runner.query(`INSERT INTO editorial_entities (id, entity_type, created_by, created_at) VALUES ($1, $2, $3, now())`, [entityId, type, userId]);
    if (status === 'reserved') return entityId;
    const changeId = randomUUID();
    await runner.query(
      `INSERT INTO proposal_changes (id, proposal_id, entity_id, operation, target_path, base_version, base_value, proposed_value,
         payload_schema_version, position, status, created_at, resolved_at)
       VALUES ($1, $2, $3, 'create_entity', 'entity', 0, '{"exists": false}', '{"exists": true}', 1, $4, 'applied', now(), now())`,
      [changeId, proposalId, entityId, changePosition++],
    );
    await runner.query(
      `UPDATE editorial_entities SET publication_status = $2::editorial_publication_status, current_version = 1, creation_change_id = $3,
         published_at = now(), withdrawn_at = CASE WHEN $2::editorial_publication_status = 'withdrawn' THEN now() END
       WHERE id = $1`,
      [entityId, status, changeId],
    );
    return entityId;
  }

  const publicId = () => randomUUID().replaceAll('-', '').slice(0, 21);

  async function insertArtist(): Promise<number> {
    const root = await insertRoot('identity', 'reserved');
    const [{ id: identityId }] = await runner.query(
      `INSERT INTO catalog_identities (uuid, public_id, display_name, type, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Identidad', 'person', now(), now(), $3) RETURNING id`,
      [randomUUID(), publicId(), root],
    );
    const [{ id }] = await runner.query(
      `INSERT INTO artists (uuid, public_id, catalog_identity_id, created_at, updated_at) VALUES ($1, $2, $3, now(), now()) RETURNING id`,
      [randomUUID(), publicId(), identityId],
    );
    return id;
  }

  async function insertRecording(): Promise<number> {
    const [{ id }] = await runner.query(
      `INSERT INTO recordings (uuid, public_id, title, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Sin Pijama', now(), now(), $3) RETURNING id`,
      [randomUUID(), publicId(), await insertRoot('recording')],
    );
    return id;
  }

  async function insertRelease({ status, cancelled = false, date = [] }: Release): Promise<number> {
    const [{ id: groupId }] = await runner.query(
      `INSERT INTO release_groups (uuid, public_id, title, type, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, 'Disco', 'album', now(), now(), $3) RETURNING id`,
      [randomUUID(), publicId(), await insertRoot('release_group')],
    );
    const [{ id }] = await runner.query(
      `INSERT INTO releases (uuid, public_id, release_group_id, release_year, release_month, release_day, is_cancelled, created_at, updated_at, editorial_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8) RETURNING id`,
      [randomUUID(), publicId(), groupId, date[0] ?? null, date[1] ?? null, date[2] ?? null, cancelled, await insertRoot('release', status)],
    );
    return id;
  }

  /** A track with its credit, and returns its id. */
  async function insertTrack(releaseId: number, recordingId: number, credits: Credit[], [disc, number] = [1, 1]): Promise<number> {
    const [{ id }] = await runner.query(
      `INSERT INTO tracks (release_id, recording_id, disc_number, track_number, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now()) RETURNING id`,
      [releaseId, recordingId, disc, number],
    );
    for (const credit of credits)
      await runner.query(
        `INSERT INTO track_artist_credits (artist_id, track_id, rank, position, credited_as, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [credit.artist, id, credit.rank, credit.position, credit.creditedAs],
      );
    return id;
  }

  const credit = (artist: number, rank: string, position: number, creditedAs: string | null = null): Credit => ({ artist, rank, position, creditedAs });

  const recordingCredit = async (recordingId: number): Promise<Credit[]> =>
    runner.query(
      `SELECT artist_id AS artist, rank, position, credited_as AS "creditedAs" FROM recording_artist_credits WHERE recording_id = $1 ORDER BY position`,
      [recordingId],
    );
  const trackCredit = async (trackId: number): Promise<Credit[]> =>
    runner.query(
      `SELECT artist_id AS artist, rank, position, credited_as AS "creditedAs" FROM track_artist_credits WHERE track_id = $1 ORDER BY position`,
      [trackId],
    );

  it('credits each recording from its track in the earliest published, not cancelled release', async () => {
    const recording = await insertRecording();
    const duo = [credit(becky, 'main', 0), credit(natti, 'featured', 1)];
    const undated = await insertTrack(await insertRelease({ status: 'published' }), recording, [credit(jennie, 'main', 0)]);
    const later = await insertTrack(await insertRelease({ status: 'published', date: [2019, 5] }), recording, [credit(becky, 'main', 0)]);
    const reserved = await insertTrack(await insertRelease({ status: 'reserved', date: [2000] }), recording, [credit(jennie, 'main', 0)]);
    const withdrawn = await insertTrack(await insertRelease({ status: 'withdrawn', date: [2001] }), recording, [credit(jennie, 'main', 0)]);
    const cancelled = await insertTrack(await insertRelease({ status: 'published', cancelled: true, date: [2010] }), recording, [credit(jennie, 'main', 0)]);
    const earliest = await insertTrack(await insertRelease({ status: 'published', date: [2018, 4, 27] }), recording, duo);

    await migration.up(runner);

    expect(await recordingCredit(recording)).toEqual(duo);
    expect(await trackCredit(earliest)).toEqual([]);
    for (const track of [undated, later, reserved, withdrawn, cancelled]) expect((await trackCredit(track)).length).toBe(1);
  });

  it('breaks a tie of dates by release, then disc and track number', async () => {
    const byRelease = await insertRecording();
    const first = await insertRelease({ status: 'published', date: [2020, 1, 1] });
    const second = await insertRelease({ status: 'published', date: [2020, 1, 1] });
    await insertTrack(second, byRelease, [credit(natti, 'main', 0)]);
    await insertTrack(first, byRelease, [credit(becky, 'main', 0)]);
    const byPosition = await insertRecording();
    await insertTrack(first, byPosition, [credit(natti, 'main', 0)], [2, 1]);
    await insertTrack(first, byPosition, [credit(jennie, 'main', 0)], [1, 7]);
    await insertTrack(first, byPosition, [credit(becky, 'main', 0)], [1, 5]);

    await migration.up(runner);

    expect(await recordingCredit(byRelease)).toEqual([credit(becky, 'main', 0)]);
    expect(await recordingCredit(byPosition)).toEqual([credit(becky, 'main', 0)]);
  });

  it('removes the printed credits identical to the recording’s and keeps the rest whole', async () => {
    const recording = await insertRecording();
    const duo = [credit(becky, 'main', 0), credit(natti, 'featured', 1)];
    await insertTrack(await insertRelease({ status: 'published', date: [2018] }), recording, duo);
    const same = await insertTrack(await insertRelease({ status: 'reserved', date: [2019] }), recording, duo);
    const fewer = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [credit(becky, 'main', 0)]);
    const more = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [...duo, credit(jennie, 'remixer', 2)]);
    const renamed = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [
      credit(becky, 'main', 0),
      credit(natti, 'featured', 1, 'Natti'),
    ]);
    const reranked = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [credit(becky, 'main', 0), credit(natti, 'main', 1)]);
    const reordered = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [
      credit(natti, 'featured', 0),
      credit(becky, 'main', 1),
    ]);

    await migration.up(runner);

    expect(await trackCredit(same)).toEqual([]);
    expect(await trackCredit(fewer)).toHaveLength(1);
    expect(await trackCredit(more)).toHaveLength(3);
    for (const track of [renamed, reranked, reordered]) expect(await trackCredit(track)).toHaveLength(2);
  });

  it('leaves a recording without a published release uncredited and its tracks’ credits in place', async () => {
    const recording = await insertRecording();
    const track = await insertTrack(await insertRelease({ status: 'reserved', date: [2018] }), recording, [credit(becky, 'main', 0)]);
    const cancelled = await insertTrack(await insertRelease({ status: 'published', cancelled: true, date: [2018] }), recording, [credit(becky, 'main', 0)]);

    await migration.up(runner);

    expect(await recordingCredit(recording)).toEqual([]);
    expect(await trackCredit(track)).toEqual([credit(becky, 'main', 0)]);
    expect(await trackCredit(cancelled)).toEqual([credit(becky, 'main', 0)]);
  });

  it('going down copies the recording’s credit back to the tracks without a printed one', async () => {
    const recording = await insertRecording();
    const duo = [credit(becky, 'main', 0), credit(natti, 'featured', 1)];
    const earliest = await insertTrack(await insertRelease({ status: 'published', date: [2018] }), recording, duo);
    const compilation = await insertTrack(await insertRelease({ status: 'published', date: [2019] }), recording, [credit(becky, 'main', 0, 'Becky G')]);
    const uncredited = await insertTrack(await insertRelease({ status: 'reserved' }), recording, []);
    await migration.up(runner);
    await runner.query(`UPDATE recording_artist_credits SET credited_as = 'Natti Natasha' WHERE recording_id = $1 AND artist_id = $2`, [recording, natti]);
    const corrected = [credit(becky, 'main', 0), credit(natti, 'featured', 1, 'Natti Natasha')];

    await migration.down(runner);

    expect(await recordingCredit(recording)).toEqual([]);
    expect(await trackCredit(earliest)).toEqual(corrected);
    expect(await trackCredit(uncredited)).toEqual(corrected);
    expect(await trackCredit(compilation)).toEqual([credit(becky, 'main', 0, 'Becky G')]);
    await migration.up(runner);
    expect(await recordingCredit(recording)).toEqual(corrected);
  });
});
