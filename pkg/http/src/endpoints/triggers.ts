/**
 * Triggers endpoint slice.
 *
 *   GET    /flows/:flowId/triggers
 *   POST   /flows/:flowId/triggers
 *   POST   /flows/:flowId/triggers/sync
 *   GET    /triggers/:triggerId
 *   PUT    /triggers/:triggerId
 *   DELETE /triggers/:triggerId
 *
 * Permission split mirrors Express's existing enforcement:
 *   - read paths use `flow:read`
 *   - write paths under `/flows/:flowId/triggers` use `flow:update` with
 *     the flow id as the resource (so RBAC's per-flow ACL applies)
 *   - direct `/triggers/:triggerId` writes use `flow:update`/`flow:delete`
 *     without a resource id (the trigger doesn't carry the flow id at the
 *     path level — looking it up to bind the resource would require a DB
 *     hop before auth, which isn't worth it for the back-compat surface)
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const listTriggers = defineEndpoint({
  id: 'triggers.list',
  method: 'GET',
  path: '/flows/:flowId/triggers',
  auth: {
    kind: 'protected',
    permission: 'flow:read',
    getResource: (request) => ({ type: 'flow', id: request.params.flowId }),
  },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.triggers.list(request.params.flowId),
    };
  },
});

const createTrigger = defineEndpoint({
  id: 'triggers.create',
  method: 'POST',
  path: '/flows/:flowId/triggers',
  auth: {
    kind: 'protected',
    permission: 'flow:update',
    getResource: (request) => ({ type: 'flow', id: request.params.flowId }),
  },
  async handle({ flowlib, request }) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.triggers.create({
        ...body,
        flowId: request.params.flowId,
      } as Parameters<typeof flowlib.triggers.create>[0]),
    };
  },
});

const syncTriggers = defineEndpoint({
  id: 'triggers.sync',
  method: 'POST',
  path: '/flows/:flowId/triggers/sync',
  auth: {
    kind: 'protected',
    permission: 'flow:update',
    getResource: (request) => ({ type: 'flow', id: request.params.flowId }),
  },
  async handle({ flowlib, request }) {
    const { definition } = (request.body ?? {}) as {
      definition?: Parameters<typeof flowlib.triggers.sync>[1];
    };
    if (!definition) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Bad Request', message: 'Body.definition is required' },
      };
    }
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.triggers.sync(request.params.flowId, definition),
    };
  },
});

const getTrigger = defineEndpoint({
  id: 'triggers.get',
  method: 'GET',
  path: '/triggers/:triggerId',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const trigger = await flowlib.triggers.get(request.params.triggerId);
    if (!trigger) {
      return {
        kind: 'json',
        status: 404,
        body: {
          error: 'Not Found',
          message: `Trigger ${request.params.triggerId} not found`,
        },
      };
    }
    return { kind: 'json', status: 200, body: trigger };
  },
});

const updateTrigger = defineEndpoint({
  id: 'triggers.update',
  method: 'PUT',
  path: '/triggers/:triggerId',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    const trigger = await flowlib.triggers.update(
      request.params.triggerId,
      (request.body ?? {}) as Parameters<typeof flowlib.triggers.update>[1],
    );
    if (!trigger) {
      return {
        kind: 'json',
        status: 404,
        body: {
          error: 'Not Found',
          message: `Trigger ${request.params.triggerId} not found`,
        },
      };
    }
    return { kind: 'json', status: 200, body: trigger };
  },
});

const deleteTrigger = defineEndpoint({
  id: 'triggers.delete',
  method: 'DELETE',
  path: '/triggers/:triggerId',
  auth: { kind: 'protected', permission: 'flow:delete' },
  async handle({ flowlib, request }) {
    await flowlib.triggers.delete(request.params.triggerId);
    return { kind: 'json', status: 204, body: null };
  },
});

export const triggersEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  listTriggers,
  createTrigger,
  syncTriggers,
  getTrigger,
  updateTrigger,
  deleteTrigger,
] as readonly FlowlibHttpEndpoint<unknown>[];
