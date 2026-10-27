import { Account, changeRole, registerFirstAdmin, registerVerified } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, decideChange, getJsonApi, reserveEntity, submitProposal } from '../support/editorial';
import { uploadedPlatformIconUrl } from '../support/images';
import { TestApp, createTestApp } from '../support/test-app';
import { createdEntryId } from '../support/vocabularies';

const present = (value: unknown) => ({ exists: true, value });
const ABSENT = { exists: false };

describe('tracks and credits of releases in the editorial flow', () => {
  let app: TestApp;
  let admin: Account;
  let moderator: Account;
  let ana: Account;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    admin = await registerFirstAdmin(app);
    moderator = await registerVerified(app, 'moderadora');
    await changeRole(app, admin.accessToken, moderator.uuid, { newRole: 'moderator', reason: 'Moderación' }).expect(201);
    ana = await registerVerified(app, 'ana');
  });

  afterAll(async () => {
    await app.close();
  });

  function apply(changeId: string) {
    return decideChange(app, moderator.accessToken, changeId, { action: 'apply' }, '?include=revision');
  }

  async function submitChanges(changes: ChangeInput[]): Promise<string[]> {
    const proposalId = await createDraft(app, ana.accessToken, 'Tracklist de la edición');
    const changeIds: string[] = [];
    for (const change of changes) {
      const { body } = await addChange(app, ana.accessToken, proposalId, change).expect(201);
      changeIds.push(body.data.id);
    }
    await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await submitProposal(app, ana.accessToken, proposalId).expect(200);
    return changeIds;
  }

  /** Submits the changes and applies each in order; returns the result key of each. */
  async function publish(changes: ChangeInput[]): Promise<Record<string, unknown>[]> {
    const keys: Record<string, unknown>[] = [];
    for (const changeId of await submitChanges(changes)) keys.push((await apply(changeId).expect(201)).body.included[0].attributes.resultKey);
    return keys;
  }

  const reserve = async (entityType: string): Promise<string> => (await reserveEntity(app, ana.accessToken, entityType).expect(201)).body.data.id;

  const creation = (entityId: string, targetPath: string, value: object): ChangeInput => ({
    entityId,
    operation: 'create_entity',
    targetPath,
    proposedValue: present(value),
  });

  const artistCreation = (entityId: string, displayName: string): ChangeInput[] => [
    creation(entityId, 'catalog_identities', { type: 'organization', displayName, organization: {} }),
    {
      entityId,
      operation: 'add_relation',
      targetPath: 'artists',
      targetKey: { catalog_identity_id: { entity_id: entityId } },
      proposedValue: present({}),
    },
  ];

  const track = (release: string, value: object): ChangeInput => ({
    entityId: release,
    operation: 'add_relation',
    targetPath: 'tracks',
    targetKey: { release_id: { entity_id: release } },
    proposedValue: present(value),
  });

  const trackCredit = (release: string, trackId: unknown, artist: string, value: object | null, operation = 'add_relation'): ChangeInput => ({
    entityId: release,
    operation,
    targetPath: 'track_artist_credits',
    targetKey: { track_id: trackId, artist_id: { entity_id: artist } },
    proposedValue: value === null ? ABSENT : present(value),
  });

  /** Publishes a recording and returns its editorial root and public id. */
  async function publishRecording(value: object = { title: 'Dynamite' }): Promise<{ entityId: string; id: string }> {
    const entityId = await reserve('recording');
    const [key] = await publish([creation(entityId, 'recordings', value)]);
    return { entityId, id: key.publicId as string };
  }

  /** Publishes a release group with its standard release; returns the release's editorial root and public id. */
  async function publishRelease(title = 'BE'): Promise<{ entityId: string; id: string }> {
    const group = await reserve('release_group');
    const entityId = await reserve('release');
    const [, key] = await publish([
      creation(group, 'release_groups', { title, type: 'album' }),
      creation(entityId, 'releases', { releaseGroup: { entity_id: group } }),
    ]);
    return { entityId, id: key.publicId as string };
  }

  /** Publishes a track and returns its id. */
  async function publishTrack(release: string, recording: string, position: { discNumber: number; trackNumber: number }, title: string | null = null): Promise<number> {
    const [key] = await publish([track(release, { recording: { entity_id: recording }, ...position, title })]);
    return key.id as number;
  }

  describe('tracks', () => {
    it('publishes an identity, a recording, a release group, a release and a track in a valid order, never pointing to a reservation', async () => {
      const artist = await reserve('identity');
      const recording = await reserve('recording');
      const group = await reserve('release_group');
      const release = await reserve('release');
      const changes = await submitChanges([
        ...artistCreation(artist, 'BTS'),
        creation(recording, 'recordings', { title: 'Dynamite' }),
        creation(group, 'release_groups', { title: 'BE', type: 'album' }),
        creation(release, 'releases', { releaseGroup: { entity_id: group } }),
        track(release, { recording: { entity_id: recording }, discNumber: 1, trackNumber: 1 }),
      ]);
      const [identityCreation, profile, recordingCreation, groupCreation, releaseCreation, trackInsertion] = changes;

      expect((await apply(trackInsertion).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await apply(identityCreation).expect(201);
      await apply(profile).expect(201);
      await apply(recordingCreation).expect(201);
      expect((await apply(trackInsertion).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      await apply(groupCreation).expect(201);
      const released = await apply(releaseCreation).expect(201);
      const trackId = (await apply(trackInsertion).expect(201)).body.included[0].attributes.resultKey.id;

      const releaseId = released.body.included[0].attributes.resultKey.publicId;
      const { body } = await getJsonApi(app, `/v1/releases/${releaseId}/tracks?include=recording`).expect(200);
      expect(body.data).toEqual([
        expect.objectContaining({
          type: 'tracks',
          id: String(trackId),
          attributes: { discNumber: 1, trackNumber: 1, title: null, displayTitle: 'Dynamite' },
        }),
      ]);
      expect(body.included[0]).toEqual(expect.objectContaining({ type: 'recordings', attributes: expect.objectContaining({ title: 'Dynamite' }) }));
    });

    it('publishes a release and its track together in an atomic group', async () => {
      const recording = await publishRecording();
      const group = await reserve('release_group');
      const release = await reserve('release');
      const atomicGroupId = '5d7c51a0-3f25-4d2b-8f2a-9b3a7c1e0d42';
      const [, , inserted] = await submitChanges([
        { ...creation(group, 'release_groups', { title: 'BE', type: 'album' }), atomicGroupId },
        { ...creation(release, 'releases', { releaseGroup: { entity_id: group } }), atomicGroupId },
        { ...track(release, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 1 }), atomicGroupId },
      ]);

      const { body } = await apply(inserted).expect(201);

      expect(body.data.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['applied', 'applied', 'applied']);
    });

    it('blocks a track whose release is rejected', async () => {
      const recording = await publishRecording();
      const group = await publishRelease();
      const release = await reserve('release');
      const groupRoot = (await getJsonApi(app, `/v1/releases/${group.id}?include=releaseGroup`).expect(200)).body.included[0].meta.editorialEntityId;
      const [releaseCreation, inserted] = await submitChanges([
        creation(release, 'releases', { releaseGroup: { entity_id: groupRoot }, editionName: 'Deluxe' }),
        track(release, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 1 }),
      ]);

      await decideChange(app, moderator.accessToken, releaseCreation, { action: 'reject', reason: 'Sin fuente' }).expect(201);

      const decisions = (await getJsonApi(app, `/v1/proposal-changes/${inserted}/decisions`, ana.accessToken).expect(200)).body.data;
      expect(decisions.map(({ attributes }: { attributes: { resultingStatus: string } }) => attributes.resultingStatus)).toEqual(['blocked']);
    });

    it('refuses a track whose recording is neither published nor created by the proposal, or whose position is not positive', async () => {
      const release = await publishRelease();
      const recording = await reserve('recording');
      const proposalId = await createDraft(app, ana.accessToken);
      const refused = async (value: object) =>
        (await addChange(app, ana.accessToken, proposalId, track(release.entityId, value)).expect(422)).body.errors[0].source.pointer;

      expect(await refused({ recording: { entity_id: recording }, discNumber: 1, trackNumber: 1 })).toBe(
        '/data/attributes/proposedValue/value/recording/entity_id',
      );
      const published = await publishRecording();
      expect(await refused({ recording: { entity_id: published.entityId }, discNumber: 0, trackNumber: 1 })).toBe('/data/attributes/proposedValue/value/discNumber');
      expect(await refused({ recording: { entity_id: published.entityId }, discNumber: 1, trackNumber: 1, title: ' ' })).toBe(
        '/data/attributes/proposedValue/value/title',
      );
    });

    it('shows the current title of its recording when it has none of its own, without copying it', async () => {
      const recording = await publishRecording({ title: 'Life Goes On' });
      const release = await publishRelease();
      const untitled = await publishTrack(release.entityId, recording.entityId, { discNumber: 1, trackNumber: 1 });
      const titled = await publishTrack(release.entityId, recording.entityId, { discNumber: 1, trackNumber: 2 }, 'Life Goes On (Like an arrow)');
      await publish([{ entityId: recording.entityId, operation: 'set_fields', targetPath: 'recordings.title', proposedValue: present('Life Goes On (Remastered)') }]);

      const untitledTrack = (await getJsonApi(app, `/v1/tracks/${untitled}`).expect(200)).body.data.attributes;
      expect(untitledTrack).toEqual({ discNumber: 1, trackNumber: 1, title: null, displayTitle: 'Life Goes On (Remastered)' });
      const titledTrack = (await getJsonApi(app, `/v1/tracks/${titled}`).expect(200)).body.data.attributes;
      expect(titledTrack.displayTitle).toBe('Life Goes On (Like an arrow)');
    });

    it('derives the explicit content of a release from the recordings of its tracks', async () => {
      const clean = await publishRecording({ title: 'Clean' });
      const explicit = await publishRecording({ title: 'Explicit', isExplicit: true });
      const release = await publishRelease();
      await publishTrack(release.entityId, clean.entityId, { discNumber: 1, trackNumber: 1 });
      expect((await getJsonApi(app, `/v1/releases/${release.id}`).expect(200)).body.data.attributes.isExplicit).toBe(false);

      await publishTrack(release.entityId, explicit.entityId, { discNumber: 1, trackNumber: 2 });

      expect((await getJsonApi(app, `/v1/releases/${release.id}`).expect(200)).body.data.attributes.isExplicit).toBe(true);
    });
  });

  describe('two tracks competing for the same position', () => {
    it('refuses two insertions of one position in the same proposal', async () => {
      const recording = await publishRecording();
      const release = await publishRelease();
      const proposalId = await createDraft(app, ana.accessToken);
      await addChange(app, ana.accessToken, proposalId, track(release.entityId, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 1 })).expect(201);
      await addChange(app, ana.accessToken, proposalId, track(release.entityId, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 2 })).expect(201);

      const { body } = await addChange(
        app,
        ana.accessToken,
        proposalId,
        track(release.entityId, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 1, title: 'Otra' }),
      ).expect(422);

      expect(body.errors[0].code).toBe('overlapping_change');
    });

    it('leaves the second insertion of a position in conflict', async () => {
      const dynamite = await publishRecording({ title: 'Dynamite' });
      const butter = await publishRecording({ title: 'Butter' });
      const release = await publishRelease();
      const [first] = await submitChanges([track(release.entityId, { recording: { entity_id: dynamite.entityId }, discNumber: 1, trackNumber: 1 })]);
      const [second] = await submitChanges([track(release.entityId, { recording: { entity_id: butter.entityId }, discNumber: 1, trackNumber: 1 })]);
      await apply(first).expect(201);

      expect((await apply(second).expect(409)).body.errors[0].code).toBe('base_changed');
      const tracks = (await getJsonApi(app, `/v1/releases/${release.id}/tracks`).expect(200)).body.data;
      expect(tracks).toHaveLength(1);
    });

    it('keeps the position unique when another selector moves a track into it, even over a confirmed base', async () => {
      const dynamite = await publishRecording({ title: 'Dynamite' });
      const butter = await publishRecording({ title: 'Butter' });
      const release = await publishRelease();
      const moved = await publishTrack(release.entityId, dynamite.entityId, { discNumber: 1, trackNumber: 2 });
      const [insertion] = await submitChanges([track(release.entityId, { recording: { entity_id: butter.entityId }, discNumber: 1, trackNumber: 1 })]);
      const [move] = await submitChanges([
        {
          entityId: release.entityId,
          operation: 'update_relation',
          targetPath: 'tracks',
          targetKey: { id: moved },
          proposedValue: present({ recording: { entity_id: dynamite.entityId }, discNumber: 1, trackNumber: 1 }),
        },
      ]);
      await apply(insertion).expect(201);

      expect((await apply(move).expect(409)).body.errors[0].code).toBe('base_changed');
      const version = (await getJsonApi(app, `/v1/editorial-entities/${release.entityId}`).expect(200)).body.data.attributes.currentVersion;
      const rebased = await decideChange(app, moderator.accessToken, move, { action: 'apply_rebased', reason: 'Revisado', confirmedVersion: version }).expect(409);
      expect(rebased.body.errors[0].code).toBe('constraint_violated');
      const positions = (await getJsonApi(app, `/v1/releases/${release.id}/tracks?include=recording`).expect(200)).body.data.map(
        ({ attributes }: { attributes: { trackNumber: number; displayTitle: string } }) => [attributes.trackNumber, attributes.displayTitle],
      );
      expect(positions).toEqual([
        [1, 'Butter'],
        [2, 'Dynamite'],
      ]);
    });
  });

  describe('presentation credits and links of a track', () => {
    async function publishArtist(displayName: string): Promise<string> {
      const entityId = await reserve('identity');
      await publish(artistCreation(entityId, displayName));
      return entityId;
    }

    it('credits artists by rank on a track created by the same proposal, once the track applies', async () => {
      const bts = await publishArtist('BTS');
      const halsey = await publishArtist('Halsey');
      const recording = await publishRecording({ title: 'Boy With Luv' });
      const release = await publishRelease('Map of the Soul: Persona');
      const proposalId = await createDraft(app, ana.accessToken, 'Tracklist');
      const add = async (change: ChangeInput) => (await addChange(app, ana.accessToken, proposalId, change).expect(201)).body.data.id as string;
      const inserted = await add(track(release.entityId, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 2 }));
      const main = await add(trackCredit(release.entityId, { change_id: inserted }, bts, { rank: 'main', position: 0 }));
      const featured = await add(trackCredit(release.entityId, { change_id: inserted }, halsey, { rank: 'featured', position: 1, creditedAs: 'Halsey' }));
      await addSource(app, ana.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
      await submitProposal(app, ana.accessToken, proposalId).expect(200);

      expect((await apply(main).expect(409)).body.errors[0].code).toBe('dependency_unresolved');
      const trackId = (await apply(inserted).expect(201)).body.included[0].attributes.resultKey.id;
      await apply(main).expect(201);
      await apply(featured).expect(201);

      const { body } = await getJsonApi(app, `/v1/tracks/${trackId}?include=artistCredits.artist`).expect(200);
      const credits = body.included.filter(({ type }: { type: string }) => type === 'track-artist-credits');
      expect(credits.map(({ attributes }: { attributes: object }) => attributes)).toEqual([
        { rank: 'main', position: 0, creditedAs: null },
        { rank: 'featured', position: 1, creditedAs: 'Halsey' },
      ]);
    });

    it('refuses a credit on an insertion of another proposal, on a track of another release, or of an identity without an artist profile', async () => {
      const bts = await publishArtist('BTS');
      const recording = await publishRecording();
      const release = await publishRelease('BE');
      const other = await publishRelease('Butter');
      const foreign = await publishTrack(other.entityId, recording.entityId, { discNumber: 1, trackNumber: 1 });
      const [inserted] = await submitChanges([track(release.entityId, { recording: { entity_id: recording.entityId }, discNumber: 1, trackNumber: 1 })]);
      const person = await reserve('identity');
      await publish([creation(person, 'catalog_identities', { type: 'person', displayName: 'RM', person: {} })]);
      const own = await publishTrack(release.entityId, recording.entityId, { discNumber: 1, trackNumber: 2 });
      const proposalId = await createDraft(app, ana.accessToken);
      const refused = async (change: ChangeInput) => (await addChange(app, ana.accessToken, proposalId, change).expect(422)).body.errors[0];

      expect((await refused(trackCredit(release.entityId, { change_id: inserted }, bts, { rank: 'main', position: 0 }))).code).toBe('invalid_reference');
      expect(await refused(trackCredit(release.entityId, foreign, bts, { rank: 'main', position: 0 }))).toEqual(
        expect.objectContaining({ code: 'relation_row_not_found', source: { pointer: '/data/attributes/targetKey/track_id' } }),
      );
      expect((await refused(trackCredit(release.entityId, own, person, { rank: 'main', position: 0 }))).code).toBe('no_artist_profile');
      expect((await refused(trackCredit(release.entityId, own, bts, { rank: 'lead', position: 0 }))).source.pointer).toBe('/data/attributes/proposedValue/value/rank');
    });

    it('keeps a track while it has credits, and an artist profile while it is credited on a track', async () => {
      const bts = await publishArtist('BTS');
      const recording = await publishRecording();
      const release = await publishRelease();
      const trackId = await publishTrack(release.entityId, recording.entityId, { discNumber: 1, trackNumber: 1 });
      await publish([trackCredit(release.entityId, trackId, bts, { rank: 'main', position: 0 })]);
      const removal: ChangeInput = { entityId: release.entityId, operation: 'remove_relation', targetPath: 'tracks', targetKey: { id: trackId }, proposedValue: ABSENT };
      const [first] = await submitChanges([removal]);

      expect((await apply(first).expect(409)).body.errors[0].code).toBe('base_changed');
      const proposalId = await createDraft(app, ana.accessToken);
      const profileRemoval = await addChange(app, ana.accessToken, proposalId, {
        entityId: bts,
        operation: 'remove_relation',
        targetPath: 'artists',
        targetKey: { catalog_identity_id: { entity_id: bts } },
        proposedValue: ABSENT,
      }).expect(422);
      expect(profileRemoval.body.errors[0].code).toBe('artist_referenced');

      await publish([trackCredit(release.entityId, trackId, bts, null, 'remove_relation')]);
      await publish([removal]);
      await getJsonApi(app, `/v1/tracks/${trackId}`).expect(404);
    });

    it('links a track on a platform that supports tracks, once per platform and URL', async () => {
      const platform = async (slug: string, supportsTrack: boolean) =>
        createdEntryId(app, admin.accessToken, 'platforms', {
          name: slug,
          slug,
          iconUrl: await uploadedPlatformIconUrl(app, admin.accessToken, slug),
          supportsTrack,
        });
      const spotify = Number(await platform('spotify', true));
      const instagram = Number(await platform('instagram', false));
      const recording = await publishRecording();
      const release = await publishRelease();
      const trackId = await publishTrack(release.entityId, recording.entityId, { discNumber: 1, trackNumber: 1 });
      const link = (platformId: number): ChangeInput => ({
        entityId: release.entityId,
        operation: 'add_relation',
        targetPath: 'track_platform_links',
        targetKey: { track_id: trackId },
        proposedValue: present({ platformId, url: 'https://open.spotify.com/track/0t1kP63rueHleOhQkYSXFY' }),
      });
      const proposalId = await createDraft(app, ana.accessToken);
      expect((await addChange(app, ana.accessToken, proposalId, link(instagram)).expect(422)).body.errors[0].code).toBe('unsupported_platform');
      const [linked] = await publish([link(spotify)]);
      const [repeated] = await submitChanges([link(spotify)]);

      const { body } = await getJsonApi(app, `/v1/releases/${release.id}/tracks?include=platformLinks.platform`).expect(200);
      expect(body.data[0].relationships.platformLinks.data).toEqual([{ type: 'track-platform-links', id: String(linked.id) }]);
      expect(body.included.map(({ type }: { type: string }) => type).sort()).toEqual(['platforms', 'track-platform-links']);
      expect((await apply(repeated).expect(201)).body.data[0].attributes.resultingStatus).toBe('satisfied');
    });
  });

  describe('credits of a release', () => {
    it('credits an identity in a role of the release scope, among its credits and filtering releases', async () => {
      const role = (slug: string, scope: string) =>
        createdEntryId(app, admin.accessToken, 'contribution-roles', { slug, name: slug, category: 'production', scopes: [scope] });
      const mastering = Number(await role('mastering', 'release'));
      const producer = Number(await role('producer', 'recording'));
      const engineer = await reserve('identity');
      const [identityKey] = await publish([creation(engineer, 'catalog_identities', { type: 'person', displayName: 'Chris Gehringer', person: {} })]);
      const release = await publishRelease();
      const credit = (roleId: number): ChangeInput => ({
        entityId: release.entityId,
        operation: 'add_relation',
        targetPath: 'release_contributions',
        proposedValue: present({ identity: { entity_id: engineer }, roleId, position: 0 }),
      });
      const proposalId = await createDraft(app, ana.accessToken);
      expect((await addChange(app, ana.accessToken, proposalId, credit(producer)).expect(422)).body.errors[0].code).toBe('role_out_of_scope');
      await publish([credit(mastering)]);

      const { body } = await getJsonApi(app, `/v1/releases/${release.id}?include=contributions.identity`).expect(200);
      expect(body.included.map(({ type }: { type: string }) => type).sort()).toEqual(['identities', 'release-contributions']);
      const identityId = identityKey.publicId as string;
      const filtered = await getJsonApi(app, `/v1/releases?filter[contributor]=${identityId}`).expect(200);
      expect(filtered.body.data.map(({ id }: { id: string }) => id)).toEqual([release.id]);
      const credits = await getJsonApi(app, `/v1/identities/${identityId}/credits?filter[scope]=release&include=release`).expect(200);
      expect(credits.body.data).toEqual([
        expect.objectContaining({ type: 'release-contributions', relationships: expect.objectContaining({ release: { data: { type: 'releases', id: release.id } } }) }),
      ]);
      expect(credits.body.included[0]).toEqual(expect.objectContaining({ type: 'releases', id: release.id }));
    });
  });
});
