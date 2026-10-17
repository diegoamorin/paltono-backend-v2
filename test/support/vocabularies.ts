import request from 'supertest';
import { DataSource } from 'typeorm';
import { sendJsonApi } from './accounts';
import { JSON_API } from './json-api';
import { TestApp } from './test-app';

/** POST /v1/{type} */
export function createEntry(app: TestApp, accessToken: string, type: string, attributes: object) {
  return sendJsonApi(app.server, 'post', `/v1/${type}`, { data: { type, attributes } }).set(
    'Authorization',
    `Bearer ${accessToken}`,
  );
}

/** Creates an entry and returns its id. */
export async function createdEntryId(app: TestApp, accessToken: string, type: string, attributes: object): Promise<string> {
  return (await createEntry(app, accessToken, type, attributes).expect(201)).body.data.id;
}

/** PATCH /v1/{type}/{id} */
export function updateEntry(app: TestApp, accessToken: string, type: string, id: string, attributes: object) {
  return sendJsonApi(app.server, 'patch', `/v1/${type}/${id}`, { data: { type, id, attributes } }).set(
    'Authorization',
    `Bearer ${accessToken}`,
  );
}

/** DELETE /v1/{type}/{id} */
export function deleteEntry(app: TestApp, accessToken: string, type: string, id: string) {
  return sendJsonApi(app.server, 'delete', `/v1/${type}/${id}`).set('Authorization', `Bearer ${accessToken}`);
}

/** GET /v1/{path}, public. */
export function getPublic(app: TestApp, path: string, query: Record<string, string> = {}) {
  return request(app.server).get(`/v1/${path}`).query(query).set('Accept', JSON_API);
}

/**
 * Stands in for the catalog tables that will reference the vocabularies, with
 * the same restrictive foreign keys, until they exist.
 */
export const VOCABULARY_REFERENCES_TABLE = 'vocabulary_references';

export async function createVocabularyReferencesTable(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS ${VOCABULARY_REFERENCES_TABLE} (
      id serial PRIMARY KEY,
      country_id integer REFERENCES countries (id) ON DELETE RESTRICT,
      genre_id integer REFERENCES genres (id) ON DELETE RESTRICT,
      platform_id integer REFERENCES platforms (id) ON DELETE RESTRICT,
      organization_type_id integer REFERENCES organization_types (id) ON DELETE RESTRICT,
      contribution_role_id integer,
      role_scope contribution_role_scope,
      FOREIGN KEY (contribution_role_id, role_scope)
        REFERENCES contribution_role_scopes (contribution_role_id, scope) ON DELETE RESTRICT
    )
  `);
}

export async function dropVocabularyReferencesTable(dataSource: DataSource): Promise<void> {
  await dataSource.query(`DROP TABLE IF EXISTS ${VOCABULARY_REFERENCES_TABLE}`);
}

/** References a vocabulary entry from the stand-in catalog table, e.g. `{ country_id: 1 }`. */
export async function referenceEntry(dataSource: DataSource, columns: Record<string, string | number>): Promise<void> {
  const names = Object.keys(columns);
  await dataSource.query(
    `INSERT INTO ${VOCABULARY_REFERENCES_TABLE} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(columns),
  );
}
