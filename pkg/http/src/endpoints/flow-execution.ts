/**
 * Flow execution endpoint slice.
 *
 *   POST /flows/:flowId/run
 *   POST /flows/:flowId/run-to-node/:nodeId
 *   POST /flow-runs/ephemeral
 *   POST /runs/ephemeral
 *   POST /node-executions/list
 */

import type { ExecuteFlowOptions, FlowInputs, NodeExecution, QueryOptions } from '@flowlib/core';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const flowResource = (id: string) => ({ type: 'flow' as const, id });

const startRun = defineEndpoint({
  id: 'flow-execution.startRun',
  method: 'POST',
  path: '/flows/:flowId/run',
  auth: {
    kind: 'protected',
    permission: 'flow-run:create',
    getResource: (request) => flowResource(request.params.flowId),
  },
  async handle({ flowlib, request }) {
    const { inputs = {}, options } = (request.body ?? {}) as {
      inputs?: FlowInputs;
      options?: ExecuteFlowOptions;
    };
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.runs.startAsync(request.params.flowId, inputs, options),
    };
  },
});

const runToNode = defineEndpoint({
  id: 'flow-execution.runToNode',
  method: 'POST',
  path: '/flows/:flowId/run-to-node/:nodeId',
  auth: {
    kind: 'protected',
    permission: 'flow-run:create',
    getResource: (request) => flowResource(request.params.flowId),
  },
  async handle({ flowlib, request }) {
    const { inputs = {}, options } = (request.body ?? {}) as {
      inputs?: FlowInputs;
      options?: ExecuteFlowOptions;
    };
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.runs.executeToNode(
        request.params.flowId,
        request.params.nodeId,
        inputs,
        options,
      ),
    };
  },
});

/**
 * Build the ephemeral handler — same logic for both `/flow-runs/ephemeral`
 * and `/runs/ephemeral` aliases. The handler factories out so the `id` and
 * `path` differ but the behaviour is identical.
 */
const ephemeralHandler: FlowlibHttpEndpoint<unknown>['handle'] = async ({ flowlib, request }) => {
  const { definition, inputs, name } = (request.body ?? {}) as {
    definition?: unknown;
    inputs?: Record<string, unknown>;
    name?: string;
  };
  if (!definition || typeof definition !== 'object') {
    return {
      kind: 'json',
      status: 400,
      body: {
        error: 'Bad Request',
        message: 'Body.definition (FlowlibDefinition) is required',
      },
    };
  }
  return {
    kind: 'json',
    status: 200,
    body: await flowlib.runs.runEphemeral(definition as never, inputs ?? {}, {
      name,
      initiatedBy: request.identity?.id,
    }),
  };
};

const runEphemeral = defineEndpoint({
  id: 'flow-execution.ephemeral',
  method: 'POST',
  path: '/flow-runs/ephemeral',
  auth: { kind: 'protected', permission: 'flow:create' },
  handle: ephemeralHandler,
});

const runEphemeralAlias = defineEndpoint({
  id: 'flow-execution.ephemeralAlias',
  method: 'POST',
  path: '/runs/ephemeral',
  auth: { kind: 'protected', permission: 'flow:create' },
  handle: ephemeralHandler,
});

const listNodeExecutions = defineEndpoint({
  id: 'flow-execution.listNodeExecutions',
  method: 'POST',
  path: '/node-executions/list',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.listNodeExecutions(
        (request.body ?? {}) as QueryOptions<NodeExecution>,
      ),
    };
  },
});

export const flowExecutionEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  startRun,
  runToNode,
  runEphemeral,
  runEphemeralAlias,
  listNodeExecutions,
] as readonly FlowlibHttpEndpoint<unknown>[];
