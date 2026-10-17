import request from 'supertest';
import { sendJsonApi } from './accounts';
import { JSON_API } from './json-api';
import { TestApp } from './test-app';

/** A GET with the JSON:API media type, as an account when a token is given. */
export function getJsonApi(app: TestApp, path: string, accessToken?: string) {
  const pending = request(app.server).get(path).set('Accept', JSON_API);
  return accessToken ? pending.set('Authorization', `Bearer ${accessToken}`) : pending;
}

function send(app: TestApp, method: 'post' | 'patch' | 'delete', path: string, accessToken: string, body?: object) {
  return sendJsonApi(app.server, method, path, body).set('Authorization', `Bearer ${accessToken}`);
}

/** POST /v1/editorial-entities */
export function reserveEntity(app: TestApp, accessToken: string, entityType = 'identity') {
  return send(app, 'post', '/v1/editorial-entities', accessToken, {
    data: { type: 'editorial-entities', attributes: { entityType } },
  });
}

/** Reserves an identity root and returns its id. */
export async function reserveIdentity(app: TestApp, accessToken: string): Promise<string> {
  const response = await reserveEntity(app, accessToken).expect(201);
  return response.body.data.id;
}

/** POST /v1/proposals */
export function createProposal(app: TestApp, accessToken: string, attributes: object = {}, relationships?: object) {
  return send(app, 'post', '/v1/proposals', accessToken, {
    data: { type: 'proposals', attributes, ...(relationships ? { relationships } : {}) },
  });
}

/** Creates a draft and returns its id. */
export async function createDraft(app: TestApp, accessToken: string, description = 'Alta de IU con su perfil de Wikipedia'): Promise<string> {
  const response = await createProposal(app, accessToken, { description }).expect(201);
  return response.body.data.id;
}

/** PATCH /v1/proposals/{id} */
export function updateProposal(app: TestApp, accessToken: string, id: string, attributes: object, relationships?: object) {
  return send(app, 'patch', `/v1/proposals/${id}`, accessToken, {
    data: { type: 'proposals', id, attributes, ...(relationships ? { relationships } : {}) },
  });
}

/** DELETE /v1/proposals/{id} */
export function discardProposal(app: TestApp, accessToken: string, id: string) {
  return send(app, 'delete', `/v1/proposals/${id}`, accessToken);
}

/** A valid creation of a person, as `proposedValue`. */
export function personCreation(overrides: object = {}) {
  return {
    exists: true,
    value: {
      type: 'person',
      displayName: 'IU',
      bio: 'Cantante y actriz surcoreana.',
      person: { givenName: 'Ji-eun', familyName: 'Lee', birthDate: '1993-05-16', heightCm: 162, gender: 'female' },
      ...overrides,
    },
  };
}

export interface ChangeInput {
  entityId: string;
  proposedValue?: object;
  operation?: string;
  targetPath?: string;
  payloadSchemaVersion?: number;
  position?: number;
  atomicGroupId?: string | null;
  targetKey?: unknown;
}

function changeDocument({ entityId, ...attributes }: ChangeInput, id?: string) {
  return {
    data: {
      type: 'proposal-changes',
      ...(id ? { id } : {}),
      attributes,
      relationships: { entity: { data: { type: 'editorial-entities', id: entityId } } },
    },
  };
}

/** POST /v1/proposals/{id}/changes, by default the creation of a person. */
export function addChange(app: TestApp, accessToken: string, proposalId: string, input: ChangeInput) {
  const attributes = {
    operation: 'create_entity',
    targetPath: 'catalog_identities',
    payloadSchemaVersion: 1,
    proposedValue: personCreation(),
    ...input,
  };
  return send(app, 'post', `/v1/proposals/${proposalId}/changes`, accessToken, changeDocument(attributes));
}

/** PATCH /v1/proposals/{id}/changes/{changeId} */
export function updateChange(app: TestApp, accessToken: string, proposalId: string, changeId: string, attributes: object) {
  return send(app, 'patch', `/v1/proposals/${proposalId}/changes/${changeId}`, accessToken, {
    data: { type: 'proposal-changes', id: changeId, attributes },
  });
}

/** DELETE /v1/proposals/{id}/changes/{changeId} */
export function removeChange(app: TestApp, accessToken: string, proposalId: string, changeId: string) {
  return send(app, 'delete', `/v1/proposals/${proposalId}/changes/${changeId}`, accessToken);
}

/** POST /v1/proposals/{id}/sources */
export function addSource(app: TestApp, accessToken: string, proposalId: string, attributes: object) {
  return send(app, 'post', `/v1/proposals/${proposalId}/sources`, accessToken, {
    data: { type: 'proposal-sources', attributes },
  });
}

/** PATCH /v1/proposals/{id}/sources/{sourceId} */
export function updateSource(app: TestApp, accessToken: string, proposalId: string, sourceId: string, attributes: object) {
  return send(app, 'patch', `/v1/proposals/${proposalId}/sources/${sourceId}`, accessToken, {
    data: { type: 'proposal-sources', id: sourceId, attributes },
  });
}

/** DELETE /v1/proposals/{id}/sources/{sourceId} */
export function removeSource(app: TestApp, accessToken: string, proposalId: string, sourceId: string) {
  return send(app, 'delete', `/v1/proposals/${proposalId}/sources/${sourceId}`, accessToken);
}

/** POST /v1/proposals/{id}/submission */
export function submitProposal(app: TestApp, accessToken: string, proposalId: string) {
  return send(app, 'post', `/v1/proposals/${proposalId}/submission`, accessToken, {
    data: { type: 'submissions' },
  });
}

export const WIKIPEDIA = 'https://es.wikipedia.org/wiki/IU_(cantante)';

/** A draft creating a new person, with a source, ready to submit. Returns the ids involved. */
export async function draftIdentityCreation(app: TestApp, accessToken: string) {
  const entityId = await reserveIdentity(app, accessToken);
  const proposalId = await createDraft(app, accessToken);
  const change = await addChange(app, accessToken, proposalId, { entityId }).expect(201);
  const source = await addSource(app, accessToken, proposalId, { url: WIKIPEDIA }).expect(201);
  return { entityId, proposalId, changeId: change.body.data.id as string, sourceId: source.body.data.id as string };
}

/** A submitted creation of a new person. */
export async function submitIdentityCreation(app: TestApp, accessToken: string) {
  const ids = await draftIdentityCreation(app, accessToken);
  await submitProposal(app, accessToken, ids.proposalId).expect(200);
  return ids;
}
