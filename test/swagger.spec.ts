import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { TestApp, createTestApp } from './support/test-app';
import { WidgetsFixtureModule } from './support/widgets-fixture';

describe('Swagger and the OpenAPI document', () => {
  describe('in development', () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await createTestApp({ env: { NODE_ENV: 'development' }, imports: [WidgetsFixtureModule] });
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves Swagger UI', async () => {
      const response = await request(app.server).get('/docs').expect(200);

      expect(response.headers['content-type']).toMatch(/^text\/html/);
    });

    it('generates a valid OpenAPI document', async () => {
      const response = await request(app.server).get('/docs-json').expect(200);

      await expect(SwaggerParser.validate(response.body)).resolves.toBeDefined();
      expect(response.body.paths).toHaveProperty(['/v1/widgets', 'get']);
      expect(response.body.paths).not.toHaveProperty(['/health']);
    });

    it('documents JSON:API documents, query parameters and errors', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);
      const list = document.paths['/v1/widgets'].get;

      expect(Object.keys(list.responses['200'].content)).toEqual(['application/vnd.api+json']);
      expect(list.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(
        expect.arrayContaining(['page[number]', 'page[size]', 'sort', 'include', 'fields[widgets]', 'filter[name]']),
      );
      expect(list.responses['400'].content['application/vnd.api+json'].schema).toEqual({
        $ref: '#/components/schemas/JsonApiErrorDocument',
      });
      const create = document.paths['/v1/widgets'].post;
      expect(Object.keys(create.requestBody.content)).toEqual(['application/vnd.api+json']);
    });

    it('documents the account endpoints, with bearer auth where they need it', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);

      expect(document.components.securitySchemes).toHaveProperty('bearer');
      expect(document.paths['/v1/users'].post.security).toBeUndefined();
      expect(document.paths['/v1/sessions'].post.responses['201'].content['application/vnd.api+json'].schema.properties)
        .toHaveProperty('meta');
      for (const [path, method] of [
        ['/v1/me', 'get'],
        ['/v1/sessions/current', 'delete'],
        ['/v1/email-verification-requests', 'post'],
        ['/v1/me/sessions', 'get'],
        ['/v1/me/sessions/{id}', 'delete'],
        ['/v1/me/password-changes', 'post'],
      ]) {
        expect(document.paths[path][method].security).toEqual([{ bearer: [] }]);
        expect(document.paths[path][method].responses).toHaveProperty('401');
      }
      expect(document.paths['/v1/email-verifications'].post.responses).toHaveProperty('204');
      expect(document.paths['/v1/email-verification-requests'].post.responses).toHaveProperty('202');
      expect(document.paths['/v1/sessions/current'].delete.responses).toHaveProperty('204');
      expect(document.paths['/v1/session-refreshes'].post.security).toEqual([{ paltono_refresh_token: [] }]);
      expect(document.paths['/v1/password-reset-requests'].post.responses).toHaveProperty('202');
      expect(document.paths['/v1/password-resets'].post.security).toBeUndefined();
    });

    it('documents role administration and the vocabularies, with bearer auth only on writes', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);

      for (const method of ['get', 'post']) {
        const operation = document.paths['/v1/admin/users/{id}/role-changes'][method];
        expect(operation.security).toEqual([{ bearer: [] }]);
        expect(operation.responses).toHaveProperty('403');
      }
      for (const type of ['countries', 'genres', 'platforms', 'organization-types', 'contribution-roles']) {
        expect(document.paths[`/v1/${type}`].get.security).toBeUndefined();
        expect(document.paths[`/v1/${type}/{id}`].get.security).toBeUndefined();
        expect(document.paths[`/v1/${type}`].post.security).toEqual([{ bearer: [] }]);
        expect(document.paths[`/v1/${type}/{id}`].patch.responses).toHaveProperty('409');
        expect(document.paths[`/v1/${type}/{id}`].delete.responses).toHaveProperty('204');
      }
      expect(document.components.schemas).toHaveProperty('ContributionRoleCreateDocument');
      expect(document.components.schemas).toHaveProperty('ContributionRoleUpdateDocument');
    });

    it('documents the editorial endpoints', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);

      expect(document.paths['/v1/editorial-operations'].get.security).toBeUndefined();
      for (const [path, method] of [
        ['/v1/editorial-entities', 'post'],
        ['/v1/editorial-entities/{id}', 'get'],
        ['/v1/editorial-entities/{id}/proposals', 'get'],
        ['/v1/proposals', 'post'],
        ['/v1/proposals/{id}', 'get'],
        ['/v1/proposals/{id}', 'patch'],
        ['/v1/proposals/{id}', 'delete'],
        ['/v1/proposals/{id}/changes', 'post'],
        ['/v1/proposals/{id}/changes', 'get'],
        ['/v1/proposals/{id}/changes/{changeId}', 'patch'],
        ['/v1/proposals/{id}/changes/{changeId}', 'delete'],
        ['/v1/proposals/{id}/sources', 'post'],
        ['/v1/proposals/{id}/sources/{sourceId}', 'patch'],
        ['/v1/proposals/{id}/sources/{sourceId}', 'delete'],
        ['/v1/proposals/{id}/submission', 'post'],
        ['/v1/proposal-changes/{id}/decisions', 'post'],
        ['/v1/proposal-changes/{id}/decisions', 'get'],
      ]) {
        expect(document.paths[path][method].tags).toEqual(['editorial']);
        expect(document.paths[path][method].responses).toHaveProperty('401');
      }
      expect(document.paths['/v1/proposals/{id}/submission'].post.responses).toHaveProperty('200');
      expect(document.paths['/v1/proposal-changes/{id}/decisions'].post.responses).toHaveProperty('201');
      expect(document.paths['/v1/proposal-changes/{id}/decisions'].get.responses).toHaveProperty('403');
    });

    it('documents the public reads of identities', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);

      expect(document.paths['/v1/identities/{id}'].get.security).toBeUndefined();
      expect(document.paths['/v1/identities/{id}'].get.tags).toEqual(['catalog-identities']);
    });

    it('documents the image upload as a multipart body with a JSON:API response', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);
      const upload = document.paths['/v1/images'].post;

      expect(Object.keys(upload.requestBody.content)).toEqual(['multipart/form-data']);
      expect(upload.requestBody.content['multipart/form-data'].schema.properties.file).toEqual(
        expect.objectContaining({ type: 'string', format: 'binary' }),
      );
      expect(Object.keys(upload.responses['201'].content)).toEqual(['application/vnd.api+json']);
      expect(upload.security).toEqual([{ bearer: [] }]);
      expect(upload.responses).toHaveProperty('429');
    });

    it('documents global search as a collection of resources of several types', async () => {
      const { body: document } = await request(app.server).get('/docs-json').expect(200);

      const data = document.paths['/v1/search'].get.responses['200'].content['application/vnd.api+json'].schema.properties.data;
      expect(data.items.oneOf.map(({ $ref }: { $ref: string }) => $ref.split('/').pop()).sort()).toEqual(
        ['ArtistResource', 'EventResource', 'IdentityResource', 'RecordingResource', 'ReleaseGroupResource', 'TourResource', 'WorkResource'].sort(),
      );
    });
  });

  describe('in production', () => {
    const production = {
      NODE_ENV: 'production',
      SWAGGER_ENABLED: undefined,
      SWAGGER_USER: undefined,
      SWAGGER_PASSWORD: undefined,
      ACCESS_TOKEN_SECRET: 'production-secret',
      RESEND_API_KEY: 're_test',
      MAIL_FROM: 'Paltono <no-reply@paltono.com>',
      MAIN_APP_URL: 'https://paltono.com',
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      R2_BUCKET: 'paltono-images',
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'secret-key',
    };

    it('is disabled by default', async () => {
      const app = await createTestApp({ env: production });
      try {
        await request(app.server).get('/docs-json').expect(404);
        await request(app.server).get('/docs').expect(404);
      } finally {
        await app.close();
      }
    });

    it('refuses to start when enabled without basic auth credentials', async () => {
      await expect(createTestApp({ env: { ...production, SWAGGER_ENABLED: 'true' } })).rejects.toThrow(
        /SWAGGER_USER/,
      );
    });

    describe('when enabled', () => {
      let app: TestApp;

      beforeAll(async () => {
        app = await createTestApp({
          env: { ...production, SWAGGER_ENABLED: 'true', SWAGGER_USER: 'staff', SWAGGER_PASSWORD: 's3cret' },
        });
      });

      afterAll(async () => {
        await app.close();
      });

      it('asks for basic auth', async () => {
        const response = await request(app.server).get('/docs-json').expect(401);

        expect(response.headers['www-authenticate']).toMatch(/^Basic/);
        await request(app.server).get('/docs').expect(401);
      });

      it('rejects wrong credentials', async () => {
        await request(app.server).get('/docs-json').auth('staff', 'wrong').expect(401);
      });

      it('serves the document with the right credentials', async () => {
        await request(app.server).get('/docs-json').auth('staff', 's3cret').expect(200);
        await request(app.server).get('/docs').auth('staff', 's3cret').expect(200);
      });
    });
  });
});
