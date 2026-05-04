/**
 * Flows endpoint slice.
 *
 *   GET    /flows                     — query-string filter
 *   GET    /flows/list                — no filter
 *   POST   /flows/list                — body filter
 *   POST   /flows
 *   GET    /flows/:id
 *   PUT    /flows/:id
 *   DELETE /flows/:id
 *   POST   /validate-flow
 *   GET    /flows/:flowId/react-flow
 *   POST   /flows/:id/versions/list
 *   POST   /flows/:id/versions
 *   GET    /flows/:id/versions/:version
 */

import type {
  CreateFlowRequest,
  Flow,
  FlowVersion,
  QueryOptions,
  UpdateFlowInput,
} from '@flowlib/core';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const flowResource = (id: string) => ({ type: 'flow' as const, id });

/**
 * `GET /flows` — query-string filtered list. Was previously a NestJS-only
 * convenience; registering it here gives all three adapters the same
 * surface (the Express + Next.js adapters never had this route before, so
 * this is a *new* endpoint on those adapters — no existing behaviour
 * breaks).
 */
const listFlowsGetWithQuery = defineEndpoint({
  id: 'flows.listGetWithQuery',
  method: 'GET',
  path: '/flows',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const query: Record<string, unknown> = {};
    request.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.list(query as QueryOptions<Flow>),
    };
  },
});

const listFlowsGet = defineEndpoint({
  id: 'flows.listGet',
  method: 'GET',
  path: '/flows/list',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib }) {
    return { kind: 'json', status: 200, body: await flowlib.flows.list() };
  },
});

const listFlowsPost = defineEndpoint({
  id: 'flows.listPost',
  method: 'POST',
  path: '/flows/list',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.list((request.body ?? {}) as QueryOptions<Flow>),
    };
  },
});

const createFlow = defineEndpoint({
  id: 'flows.create',
  method: 'POST',
  path: '/flows',
  auth: { kind: 'protected', permission: 'flow:create' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.flows.create((request.body ?? {}) as CreateFlowRequest),
    };
  },
});

const getFlow = defineEndpoint({
  id: 'flows.get',
  method: 'GET',
  path: '/flows/:id',
  auth: {
    kind: 'protected',
    permission: 'flow:read',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return { kind: 'json', status: 200, body: await flowlib.flows.get(request.params.id) };
  },
});

const updateFlow = defineEndpoint({
  id: 'flows.update',
  method: 'PUT',
  path: '/flows/:id',
  auth: {
    kind: 'protected',
    permission: 'flow:update',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.update(request.params.id, (request.body ?? {}) as UpdateFlowInput),
    };
  },
});

const deleteFlow = defineEndpoint({
  id: 'flows.delete',
  method: 'DELETE',
  path: '/flows/:id',
  auth: {
    kind: 'protected',
    permission: 'flow:delete',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    await flowlib.flows.delete(request.params.id);
    return { kind: 'json', status: 204, body: null };
  },
});

const validateFlow = defineEndpoint({
  id: 'flows.validate',
  method: 'POST',
  path: '/validate-flow',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const { flowId, flowDefinition } = (request.body ?? {}) as {
      flowId?: string;
      flowDefinition?: Parameters<typeof flowlib.flows.validate>[1];
    };
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.validate(
        flowId as string,
        flowDefinition as Parameters<typeof flowlib.flows.validate>[1],
      ),
    };
  },
});

const reactFlow = defineEndpoint({
  id: 'flows.reactFlow',
  method: 'GET',
  path: '/flows/:flowId/react-flow',
  auth: {
    kind: 'protected',
    permission: 'flow:read',
    getResource: (request) => flowResource(request.params.flowId),
  },
  async handle({ flowlib, request }) {
    const options: { version?: string | number | 'latest'; flowRunId?: string } = {};
    const version = request.searchParams.get('version');
    const flowRunId = request.searchParams.get('flowRunId');
    if (version) {
      options.version = version;
    }
    if (flowRunId) {
      options.flowRunId = flowRunId;
    }
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.flows.renderToReactFlow(request.params.flowId, options),
    };
  },
});

const listVersionsPost = defineEndpoint({
  id: 'flows.listVersions',
  method: 'POST',
  path: '/flows/:id/versions/list',
  auth: {
    kind: 'protected',
    permission: 'flow-version:read',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.versions.list(
        request.params.id,
        (request.body ?? {}) as QueryOptions<FlowVersion>,
      ),
    };
  },
});

const createVersion = defineEndpoint({
  id: 'flows.createVersion',
  method: 'POST',
  path: '/flows/:id/versions',
  auth: {
    kind: 'protected',
    permission: 'flow-version:create',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.versions.create(
        request.params.id,
        (request.body ?? {}) as Parameters<typeof flowlib.versions.create>[1],
      ),
    };
  },
});

const getVersion = defineEndpoint({
  id: 'flows.getVersion',
  method: 'GET',
  path: '/flows/:id/versions/:version',
  auth: {
    kind: 'protected',
    permission: 'flow-version:read',
    getResource: (request) => flowResource(request.params.id),
  },
  async handle({ flowlib, request }) {
    const version = await flowlib.versions.get(request.params.id, request.params.version);
    if (!version) {
      return {
        kind: 'json',
        status: 404,
        body: {
          error: 'Not Found',
          message: `Version ${request.params.version} not found for flow ${request.params.id}`,
        },
      };
    }
    return { kind: 'json', status: 200, body: version };
  },
});

export const flowsEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  // List GETs must come before /flows/:id GET (Express + matcher walk in order)
  listFlowsGet,
  listFlowsGetWithQuery,
  listFlowsPost,
  createFlow,
  // Versions paths first so they match before generic /flows/:id
  listVersionsPost,
  createVersion,
  getVersion,
  reactFlow,
  validateFlow,
  getFlow,
  updateFlow,
  deleteFlow,
] as readonly FlowlibHttpEndpoint<unknown>[];
