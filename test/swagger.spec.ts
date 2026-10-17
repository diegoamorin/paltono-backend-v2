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
      ]) {
        expect(document.paths[path][method].security).toEqual([{ bearer: [] }]);
        expect(document.paths[path][method].responses).toHaveProperty('401');
      }
      expect(document.paths['/v1/email-verifications'].post.responses).toHaveProperty('204');
      expect(document.paths['/v1/email-verification-requests'].post.responses).toHaveProperty('202');
      expect(document.paths['/v1/sessions/current'].delete.responses).toHaveProperty('204');
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
      FRONTEND_URL_KPOP: 'https://kpop.paltono.com',
      FRONTEND_URL_MAIN: 'https://paltono.com',
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
