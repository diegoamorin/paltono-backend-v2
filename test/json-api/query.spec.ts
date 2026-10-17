import request from 'supertest';
import { JSON_API } from '../support/json-api';
import { TestApp, createTestApp } from '../support/test-app';
import { WidgetsFixtureModule } from '../support/widgets-fixture';

interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

describe('JSON:API query parameters and documents', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ imports: [WidgetsFixtureModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (url: string) => request(app.server).get(url).set('Accept', JSON_API);
  const ids = (body: { data: Resource[] }) => body.data.map((resource) => resource.id);

  const expectBadParameter = async (url: string, parameter: string) => {
    const response = await get(url).expect(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ status: '400', title: 'Bad Request', source: { parameter } }),
    ]);
  };

  describe('pagination', () => {
    it('returns the first 20 resources with links and the total by default', async () => {
      const response = await get('/v1/widgets').expect(200);

      expect(response.body.jsonapi).toEqual({ version: '1.1' });
      expect(response.body.data).toHaveLength(20);
      expect(response.body.meta).toEqual({ total: 45 });
      expect(response.body.links).toEqual({
        self: '/v1/widgets?page%5Bnumber%5D=1&page%5Bsize%5D=20',
        first: '/v1/widgets?page%5Bnumber%5D=1&page%5Bsize%5D=20',
        prev: null,
        next: '/v1/widgets?page%5Bnumber%5D=2&page%5Bsize%5D=20',
        last: '/v1/widgets?page%5Bnumber%5D=3&page%5Bsize%5D=20',
      });
    });

    it('serves a later page and keeps the other parameters in its links', async () => {
      const response = await get('/v1/widgets?sort=price&page[number]=3').expect(200);

      expect(response.body.data).toHaveLength(5);
      expect(response.body.links.prev).toBe('/v1/widgets?sort=price&page%5Bnumber%5D=2&page%5Bsize%5D=20');
      expect(response.body.links.next).toBeNull();
    });

    it('accepts a page size of up to 100', async () => {
      const response = await get('/v1/widgets?page[size]=100').expect(200);

      expect(response.body.data).toHaveLength(45);
      expect(response.body.links.last).toBe('/v1/widgets?page%5Bnumber%5D=1&page%5Bsize%5D=100');
    });

    it.each([
      ['page[size]=101', 'page[size]'],
      ['page[size]=0', 'page[size]'],
      ['page[number]=0', 'page[number]'],
      ['page[number]=two', 'page[number]'],
      ['page[offset]=5', 'page[offset]'],
    ])('rejects %s', async (query, parameter) => {
      await expectBadParameter(`/v1/widgets?${query}`, parameter);
    });
  });

  describe('sorting', () => {
    it('applies the default sort when none is requested', async () => {
      const response = await get('/v1/widgets?page[size]=3').expect(200);

      expect(ids(response.body)).toEqual(['45', '44', '43']);
    });

    it('breaks ties by id so the order is stable', async () => {
      const response = await get('/v1/widgets?sort=name&page[size]=4').expect(200);

      expect(response.body.data.map((widget: Resource) => widget.attributes?.name)).toEqual([
        'Lightstick',
        'Lightstick',
        'Lightstick',
        'Lightstick',
      ]);
      expect(ids(response.body)).toEqual(['3', '6', '9', '12']);
    });

    it('sorts by several fields, descending with a minus sign', async () => {
      const response = await get('/v1/widgets?sort=-price,name&page[size]=3').expect(200);

      expect(response.body.data.map((widget: Resource) => widget.attributes)).toEqual([
        expect.objectContaining({ price: 49, name: 'Lightstick' }),
        expect.objectContaining({ price: 48, name: 'Photocard' }),
        expect.objectContaining({ price: 47, name: 'Poster' }),
      ]);
    });

    it.each(['colour', 'name,,price', '-'])('rejects sort=%s', async (sort) => {
      await expectBadParameter(`/v1/widgets?sort=${sort}`, 'sort');
    });
  });

  describe('filtering', () => {
    it('applies a documented filter', async () => {
      const response = await get('/v1/widgets?filter[name]=Poster').expect(200);

      expect(response.body.meta.total).toBe(15);
    });

    it.each([
      ['filter[colour]=red', 'filter[colour]'],
      ['filter=red', 'filter'],
      ['filter[name]=a&filter[name]=b', 'filter[name]'],
    ])('rejects %s', async (query, parameter) => {
      await expectBadParameter(`/v1/widgets?${query}`, parameter);
    });
  });

  describe('include', () => {
    it('adds the requested related resources once each', async () => {
      const response = await get('/v1/widgets?include=maker.country&page[size]=6').expect(200);

      expect(response.body.data[0].relationships.maker).toEqual({ data: { type: 'makers', id: expect.any(String) } });
      const included = response.body.included.map((resource: Resource) => `${resource.type}:${resource.id}`);
      expect(included.sort()).toEqual(['countries:KR', 'countries:US', 'makers:1', 'makers:2', 'makers:3']);
      const maker = response.body.included.find((resource: Resource) => resource.type === 'makers');
      expect(maker.relationships.country.data).toEqual({ type: 'countries', id: expect.any(String) });
    });

    it('includes to-many relationships', async () => {
      const response = await get('/v1/widgets?include=tags&page[size]=1').expect(200);

      expect(response.body.data[0].relationships.tags.data).toEqual([
        { type: 'tags', id: 'limited' },
        { type: 'tags', id: 'official' },
      ]);
      expect(response.body.included).toHaveLength(2);
    });

    it('leaves out the included member when nothing is included', async () => {
      const response = await get('/v1/widgets').expect(200);

      expect(response.body).not.toHaveProperty('included');
    });

    it.each(['owner', 'maker.owner', 'maker..country', 'maker.country.continent'])(
      'rejects include=%s',
      async (include) => {
        await expectBadParameter(`/v1/widgets?include=${include}`, 'include');
      },
    );
  });

  describe('sparse fieldsets', () => {
    it('returns only the requested fields of each type', async () => {
      const response = await get('/v1/widgets?include=maker&fields[widgets]=name,maker&fields[makers]=name').expect(200);

      const widget = response.body.data[0];
      expect(Object.keys(widget.attributes)).toEqual(['name']);
      expect(Object.keys(widget.relationships)).toEqual(['maker']);
      const maker = response.body.included[0];
      expect(maker.attributes).toEqual({ name: expect.any(String) });
      expect(maker).not.toHaveProperty('relationships');
    });

    it('accepts an empty fieldset', async () => {
      const response = await get('/v1/widgets?fields[widgets]=').expect(200);

      expect(response.body.data[0]).toEqual({ type: 'widgets', id: '45' });
    });

    it.each([
      ['fields[widgets]=colour', 'fields[widgets]'],
      ['fields[owners]=name', 'fields[owners]'],
      ['fields=name', 'fields'],
    ])('rejects %s', async (query, parameter) => {
      await expectBadParameter(`/v1/widgets?${query}`, parameter);
    });
  });

  describe('a single resource', () => {
    it('returns the resource with its included relationships', async () => {
      const response = await get('/v1/widgets/1?include=maker').expect(200);

      expect(response.body.data).toMatchObject({ type: 'widgets', id: '1', attributes: { name: 'Photocard' } });
      expect(response.body.links).toEqual({ self: '/v1/widgets/1' });
      expect(response.body.included).toEqual([expect.objectContaining({ type: 'makers' })]);
    });

    it.each([
      ['sort=name', 'sort'],
      ['page[number]=1', 'page[number]'],
      ['filter[name]=Poster', 'filter[name]'],
    ])('rejects collection parameters such as %s', async (query, parameter) => {
      await expectBadParameter(`/v1/widgets/1?${query}`, parameter);
    });
  });

  it('rejects unknown query parameters', async () => {
    await expectBadParameter('/v1/widgets?colour=red', 'colour');
  });

  it('lets tests control the time the application sees', async () => {
    app.clock.set('2026-03-01T00:00:00.000Z');
    expect((await get('/v1/widgets/45').expect(200)).body.data.attributes.isNew).toBe(true);

    app.clock.set('2026-06-01T00:00:00.000Z');
    expect((await get('/v1/widgets/45').expect(200)).body.data.attributes.isNew).toBe(false);
  });
});
