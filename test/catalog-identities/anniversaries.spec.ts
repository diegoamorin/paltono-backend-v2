import { sendJsonApi } from '../support/accounts';
import { Account, registerFirstAdmin } from '../support/administration';
import { ChangeInput, WIKIPEDIA, addChange, addSource, createDraft, getJsonApi, reserveIdentity } from '../support/editorial';
import { TestApp, createTestApp } from '../support/test-app';

interface Row {
  id: string;
  attributes: { kind: string; date: object };
  relationships: { identity: { data: { id: string } } };
}

describe('GET /v1/anniversaries (C11)', () => {
  let app: TestApp;
  let admin: Account;
  /** Public ids by display name. */
  const identities: Record<string, string> = {};
  const roots: Record<string, string> = {};

  /** Publishes the given microchanges directly, as staff may (E18). */
  async function publish(changes: ChangeInput[]): Promise<void> {
    const proposalId = await createDraft(app, admin.accessToken, 'Datos del catálogo');
    for (const change of changes) await addChange(app, admin.accessToken, proposalId, change).expect(201);
    await addSource(app, admin.accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
    await sendJsonApi(app.server, 'post', `/v1/proposals/${proposalId}/publication`, { data: { type: 'publications' } })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  }

  /** Publishes an identity, and an artist profile with the given debut if it has one. */
  async function publishIdentity(value: { type: string; displayName: string; person?: object; organization?: object }, debut?: object): Promise<void> {
    const entityId = await reserveIdentity(app, admin.accessToken);
    await publish([{ entityId, proposedValue: { exists: true, value } }]);
    if (debut) {
      await publish([
        {
          entityId,
          operation: 'add_relation',
          targetPath: 'artists',
          targetKey: { catalog_identity_id: { entity_id: entityId } },
          proposedValue: { exists: true, value: {} },
        },
      ]);
      await publish([{ entityId, operation: 'set_fields', targetPath: 'artists.debut', proposedValue: { exists: true, value: debut } }]);
    }
    const revisions = await getJsonApi(app, `/v1/editorial-entities/${entityId}/revisions`, admin.accessToken).expect(200);
    identities[value.displayName] = revisions.body.data[0].attributes.resultKey.publicId;
    roots[value.displayName] = entityId;
  }

  const person = (displayName: string, fields: object, debut?: object) => publishIdentity({ type: 'person', displayName, person: fields }, debut);

  const organization = (displayName: string, fields: object, debut?: object) => publishIdentity({ type: 'organization', displayName, organization: fields }, debut);

  const list = (query = '') => getJsonApi(app, `/v1/anniversaries${query}`);

  /** The rows of a filtered list in order, as `displayName kind`, read through `include=identity`. */
  async function rows(filters = ''): Promise<string[]> {
    const { body } = await list(`?include=identity&page[size]=100${filters && `&${filters}`}`).expect(200);
    const names = new Map(body.included.map(({ id, attributes }: { id: string; attributes: { displayName: string } }) => [id, attributes.displayName]));
    return body.data.map(({ attributes, relationships }: Row) => `${names.get(relationships.identity.data.id)} ${attributes.kind}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.reset();
    admin = await registerFirstAdmin(app);

    await person('IU', { birthDate: { year: 1993, month: 5, day: 16 } }, { year: 2008, month: 9, day: 18 });
    await person('Kim Sowol', { birthDate: { year: 1990, month: 5, day: 8 }, deathDate: { year: 2017, month: 5 } }, { year: 2008, month: 5, day: 25 });
    await person('Ahn Hyo-jin', { birthDate: { month: 5, day: 2 } });
    await person('Yoon Sang', { birthDate: { year: 1968 } });
    await person('Cho Yong-pil', { birthDate: { year: 1950, month: 5, day: 20 }, deathDate: { year: 2020 } });
    await person('Sunmi', { birthDate: { year: 1992, month: 11, day: 20 } }, { year: 2007, month: 11, day: 20 });
    await person('Yuna', { birthDate: { year: 1995, month: 11, day: 9 } });
    await person('Yuna', { birthDate: { year: 1995, month: 11, day: 9 } });
    await organization('Wonder Group', { founding: { year: 2007, month: 5, day: 16 }, dissolution: { year: 2017, month: 1 } }, { year: 2008, month: 2, day: 13 });
    await organization('EDAM Entertainment', { founding: { year: 2015, month: 5 } });

    await person('Retirada', { birthDate: { year: 1990, month: 5, day: 16 } });
    await publish([{ entityId: roots.Retirada, operation: 'withdraw_entity', targetPath: 'publication_status', proposedValue: { exists: true, value: 'withdrawn' } }]);

    const reservation = await reserveIdentity(app, admin.accessToken);
    const draft = await createDraft(app, admin.accessToken, 'Alta pendiente');
    await addChange(app, admin.accessToken, draft, {
      entityId: reservation,
      proposedValue: { exists: true, value: { type: 'person', displayName: 'Reserva', person: { birthDate: { year: 1990, month: 5, day: 16 } } } },
    }).expect(201);
  });

  afterAll(() => app.close());

  it('shows a date with its kind, its partial date and its identity', async () => {
    const { body } = await list('?include=identity&page[size]=100').expect(200);

    expect(body.data.find(({ id }: Row) => id === `${identities.IU}.birth`)).toEqual({
      type: 'anniversaries',
      id: `${identities.IU}.birth`,
      attributes: { kind: 'birth', date: { year: 1993, month: 5, day: 16 } },
      relationships: { identity: { data: { type: 'identities', id: identities.IU } } },
    });
    expect(body.included).toContainEqual(expect.objectContaining({ type: 'identities', id: identities.IU }));
  });

  it('shows a birth without a year, with a null year', async () => {
    const { body } = await list('?page[size]=100').expect(200);

    expect(body.data.find(({ id }: Row) => id === `${identities['Ahn Hyo-jin']}.birth`).attributes.date).toEqual({ year: null, month: 5, day: 2 });
  });

  it('leaves the identity out unless it is included', async () => {
    const { body } = await list().expect(200);

    expect(body.included).toBeUndefined();
  });

  it('lists every date with a month by month and day, then name and kind, without withdrawn entries or reservations', async () => {
    expect(await rows()).toEqual([
      'Wonder Group dissolution',
      'Wonder Group debut',
      'Ahn Hyo-jin birth',
      'Kim Sowol birth',
      'IU birth',
      'Wonder Group founding',
      'Cho Yong-pil birth',
      'Kim Sowol debut',
      'EDAM Entertainment founding',
      'Kim Sowol death',
      'IU debut',
      'Yuna birth',
      'Yuna birth',
      'Sunmi birth',
      'Sunmi debut',
    ]);
  });

  it('keeps one row per date, with a stable id of the identity and the kind', async () => {
    const { body } = await list('?page[size]=100').expect(200);
    const sowol = identities['Kim Sowol'];

    expect(body.data.map(({ id }: Row) => id).filter((id: string) => id.startsWith(sowol))).toEqual([`${sowol}.birth`, `${sowol}.debut`, `${sowol}.death`]);
    expect(body.meta.total).toBe(15);
  });

  describe('by month and day', () => {
    it('lists a month, with the dates without a day at its end', async () => {
      expect(await rows('filter[month]=5')).toEqual([
        'Ahn Hyo-jin birth',
        'Kim Sowol birth',
        'IU birth',
        'Wonder Group founding',
        'Cho Yong-pil birth',
        'Kim Sowol debut',
        'EDAM Entertainment founding',
        'Kim Sowol death',
      ]);
    });

    it('lists a day of a month, without the dates that have no day', async () => {
      expect(await rows('filter[month]=5&filter[day]=16')).toEqual(['IU birth', 'Wonder Group founding']);
      expect(await rows('filter[month]=1&filter[day]=1')).toEqual([]);
    });

    it('takes a day no month has as an empty list', async () => {
      expect(await rows('filter[month]=2&filter[day]=31')).toEqual([]);
    });

    it.each(['filter[month]=0', 'filter[month]=13', 'filter[month]=05', 'filter[month]=may', 'filter[month]=', 'filter[month]=5&filter[day]=0', 'filter[month]=5&filter[day]=32', 'filter[month]=5&filter[day]=x'])(
      'refuses %s',
      async (filters) => {
        await list(`?${filters}`).expect(400);
      },
    );

    it('refuses a day without a month', async () => {
      const { body } = await list('?filter[day]=16').expect(400);

      expect(body.errors[0].source).toEqual({ parameter: 'filter[day]' });
    });
  });

  describe('by kind', () => {
    it('lists one kind', async () => {
      expect(await rows('filter[kind]=death')).toEqual(['Kim Sowol death']);
    });

    it('lists several kinds, separated by commas', async () => {
      expect(await rows('filter[kind]=founding,dissolution')).toEqual(['Wonder Group dissolution', 'Wonder Group founding', 'EDAM Entertainment founding']);
    });

    it('keeps one row per date when a kind is repeated', async () => {
      expect(await rows('filter[kind]=death,death')).toEqual(['Kim Sowol death']);
    });

    it.each(['filter[kind]=wedding', 'filter[kind]=birth,wedding', 'filter[kind]=', 'filter[kind]=birth,'])('refuses %s', async (filters) => {
      await list(`?${filters}`).expect(400);
    });
  });

  describe('by deceased', () => {
    it('leaves out every date of an identity with a recorded death, even one known only by its year', async () => {
      const shown = await rows('filter[deceased]=false&filter[month]=5');

      expect(shown).toEqual(['Ahn Hyo-jin birth', 'IU birth', 'Wonder Group founding', 'EDAM Entertainment founding']);
    });

    it('lists only the dates of identities with a recorded death', async () => {
      expect(await rows('filter[deceased]=true')).toEqual(['Kim Sowol birth', 'Cho Yong-pil birth', 'Kim Sowol debut', 'Kim Sowol death']);
    });

    it('refuses any other value', async () => {
      await list('?filter[deceased]=maybe').expect(400);
    });
  });

  describe('by artist profile', () => {
    it('lists only the dates of identities with an artist profile', async () => {
      const shown = await rows('filter[hasArtistProfile]=true&filter[month]=5');

      expect(shown).toEqual(['Kim Sowol birth', 'IU birth', 'Wonder Group founding', 'Kim Sowol debut', 'Kim Sowol death']);
    });

    it('lists only the dates of identities without one', async () => {
      const shown = await rows('filter[hasArtistProfile]=false&filter[month]=5');

      expect(shown).toEqual(['Ahn Hyo-jin birth', 'Cho Yong-pil birth', 'EDAM Entertainment founding']);
    });

    it('refuses any other value', async () => {
      await list('?filter[hasArtistProfile]=maybe').expect(400);
    });
  });

  it('counts only what the filters leave', async () => {
    const { body } = await list('?filter[month]=5&filter[kind]=founding').expect(200);

    expect(body.meta.total).toBe(2);
  });

  describe('pagination and order', () => {
    it('walks every row once across pages, also between homonyms with the same date', async () => {
      const all = (await list('?page[size]=100').expect(200)).body.data.map(({ id }: Row) => id);
      const walked: string[] = [];
      for (let number = 1; number <= all.length; number += 1) {
        const { body } = await list(`?page[size]=1&page[number]=${number}`).expect(200);
        walked.push(...body.data.map(({ id }: Row) => id));
      }

      expect(walked).toEqual(all);
      expect(new Set(walked).size).toBe(15);
    });

    it.each(['sort=id', 'sort=-id', 'sort=displayName', 'sort=month'])('refuses %s, because the order is fixed', async (sort) => {
      await list(`?${sort}`).expect(400);
    });

    it('refuses an unknown filter and an include outside the identity', async () => {
      await list('?filter[q]=iu').expect(400);
      await list('?include=identity.aliases').expect(400);
    });
  });
});
