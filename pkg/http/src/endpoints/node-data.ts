/**
 * Node data, config, definition, and action loader endpoint slice.
 *
 *   POST /node-data/test-expression
 *   POST /node-data/test-mapper
 *   POST /node-data/model-query
 *   GET  /node-data/models
 *   POST /node-config/update
 *   GET  /node-definition/:nodeType
 *   GET  /actions/:actionId/fields/:fieldName/options
 *   GET  /actions/:actionId/loaders/:loaderName
 */

import { BatchProvider } from '@flowlib/core';
import { coerceSingleQueryValue, parseJsonQueryParam } from '../parsing/query';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const testExpression = defineEndpoint({
  id: 'node-data.testExpression',
  method: 'POST',
  path: '/node-data/test-expression',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.testing.testJsExpression(
        (request.body ?? {}) as Parameters<typeof flowlib.testing.testJsExpression>[0],
      ),
    };
  },
});

const testMapper = defineEndpoint({
  id: 'node-data.testMapper',
  method: 'POST',
  path: '/node-data/test-mapper',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.testing.testMapper(
        (request.body ?? {}) as Parameters<typeof flowlib.testing.testMapper>[0],
      ),
    };
  },
});

const modelQuery = defineEndpoint({
  id: 'node-data.modelQuery',
  method: 'POST',
  path: '/node-data/model-query',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.testing.testModelPrompt(
        (request.body ?? {}) as Parameters<typeof flowlib.testing.testModelPrompt>[0],
      ),
    };
  },
});

const getModels = defineEndpoint({
  id: 'node-data.models',
  method: 'GET',
  path: '/node-data/models',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const sp = request.searchParams;
    const credentialId = (sp.get('credentialId') ?? '').trim();
    const providerQuery = (sp.get('provider') ?? '').trim().toUpperCase();
    if (credentialId) {
      return {
        kind: 'json',
        status: 200,
        body: await flowlib.testing.getModelsForCredential(credentialId),
      };
    }
    if (providerQuery) {
      if (!Object.values(BatchProvider).includes(providerQuery as BatchProvider)) {
        return {
          kind: 'json',
          status: 400,
          body: {
            error: 'INVALID_PROVIDER',
            message: `Unsupported provider '${providerQuery}'. Expected one of: ${Object.values(BatchProvider).join(', ')}`,
          },
        };
      }
      return {
        kind: 'json',
        status: 200,
        body: await flowlib.testing.getModelsForProvider(providerQuery as BatchProvider),
      };
    }
    return { kind: 'json', status: 200, body: await flowlib.testing.getAvailableModels() };
  },
});

const nodeConfigUpdate = defineEndpoint({
  id: 'node-config.update',
  method: 'POST',
  path: '/node-config/update',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.actions.handleConfigUpdate(
        (request.body ?? {}) as Parameters<typeof flowlib.actions.handleConfigUpdate>[0],
      ),
    };
  },
});

const nodeDefinition = defineEndpoint({
  id: 'node-definition.get',
  method: 'GET',
  path: '/node-definition/:nodeType',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const nodeType = request.params.nodeType ?? '';
    if (!nodeType.includes('.')) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'INVALID_NODE_TYPE', message: `Unknown node type '${nodeType}'` },
      };
    }
    const sp = request.searchParams;
    const params = parseJsonQueryParam(sp.get('params'));
    const changeField = sp.get('changeField') ?? undefined;
    const changeValue = coerceSingleQueryValue(sp.get('changeValue') ?? undefined);
    const nodeId = sp.get('nodeId') ?? undefined;
    const flowId = sp.get('flowId') ?? undefined;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.actions.handleConfigUpdate({
        nodeType,
        nodeId: nodeId ?? `definition-${nodeType.toLowerCase()}`,
        flowId,
        params,
        change: changeField ? { field: changeField, value: changeValue } : undefined,
      }),
    };
  },
});

const actionFieldOptions = defineEndpoint({
  id: 'actions.fieldOptions',
  method: 'GET',
  path: '/actions/:actionId/fields/:fieldName/options',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const depsRaw = request.searchParams.get('deps');
    let deps: Record<string, unknown> = {};
    if (typeof depsRaw === 'string') {
      try {
        deps = JSON.parse(depsRaw);
      } catch {
        return { kind: 'json', status: 400, body: { error: 'Invalid deps JSON' } };
      }
    }
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.actions.resolveFieldOptions(
        request.params.actionId,
        request.params.fieldName,
        deps,
      ),
    };
  },
});

const actionLoader = defineEndpoint({
  id: 'actions.loader',
  method: 'GET',
  path: '/actions/:actionId/loaders/:loaderName',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib, request }) {
    const depsRaw = request.searchParams.get('deps');
    let deps: Record<string, unknown> = {};
    if (typeof depsRaw === 'string') {
      try {
        deps = JSON.parse(depsRaw);
      } catch {
        return { kind: 'json', status: 400, body: { error: 'Invalid deps JSON' } };
      }
    }
    const query = request.searchParams.get('query') ?? undefined;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.actions.resolveActionLoader(
        request.params.actionId,
        request.params.loaderName,
        deps,
        query,
      ),
    };
  },
});

export const nodeDataEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  testExpression,
  testMapper,
  modelQuery,
  getModels,
  nodeConfigUpdate,
  nodeDefinition,
  actionFieldOptions,
  actionLoader,
] as readonly FlowlibHttpEndpoint<unknown>[];
