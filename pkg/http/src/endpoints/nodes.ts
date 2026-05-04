/**
 * Nodes endpoint slice.
 *
 *   GET  /nodes        — available node definitions, far-future cached
 *   POST /nodes/test   — execute a single node in isolation
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const listNodes = defineEndpoint({
  id: 'nodes.list',
  method: 'GET',
  path: '/nodes',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib }) {
    return {
      kind: 'json',
      status: 200,
      body: flowlib.actions.getAvailableNodes(),
      headers: { 'Cache-Control': 'public, max-age=3600' },
    };
  },
});

const testNode = defineEndpoint({
  id: 'nodes.test',
  method: 'POST',
  path: '/nodes/test',
  auth: { kind: 'protected', permission: 'flow:update' },
  async handle({ flowlib, request }) {
    const { nodeType, params, inputData } = (request.body ?? {}) as {
      nodeType?: unknown;
      params?: unknown;
      inputData?: Record<string, unknown>;
    };
    if (!nodeType || typeof nodeType !== 'string') {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'nodeType is required and must be a string' },
      };
    }
    if (!params || typeof params !== 'object') {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'params is required and must be an object' },
      };
    }
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.testing.testNode(
        nodeType,
        params as Record<string, unknown>,
        inputData ?? {},
      ),
    };
  },
});

export const nodesEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  testNode,
  listNodes,
] as readonly FlowlibHttpEndpoint<unknown>[];
