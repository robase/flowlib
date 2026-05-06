/**
 * Flow execution endpoint slice.
 *
 *   POST /flows/:flowId/run
 *   POST /flows/:flowId/run-to-node/:nodeId
 *   POST /flow-runs/ephemeral
 *   POST /runs/ephemeral
 *   POST /node-executions/list
 */

import {
  FlowInputsSchema,
  RunFlowBodySchema,
  flowlibDefinitionSchema,
  type NodeExecution,
  type QueryOptions,
} from '@flowlib/core';
import { z } from 'zod/v4';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const flowResource = (id: string) => ({ type: 'flow' as const, id });

/**
 * Format a Zod failure into a 400 response. Returned as JSON so clients can
 * surface field-level errors; we don't echo the raw issues object because it
 * leaks internal field names — just the high-signal `path` + `message`.
 */
function badRequest(error: z.ZodError): {
  kind: 'json';
  status: 400;
  body: { error: string; message: string; issues: Array<{ path: string; message: string }> };
} {
  return {
    kind: 'json',
    status: 400,
    body: {
      error: 'Bad Request',
      message: 'Request body failed validation',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  };
}

const EphemeralBodySchema = z.object({
  definition: flowlibDefinitionSchema,
  inputs: FlowInputsSchema.optional(),
  name: z.string().optional(),
});

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
    const parsed = RunFlowBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(parsed.error);
    }
    const { inputs, options } = parsed.data;
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.runs.startAsync(request.params.flowId, inputs ?? {}, options),
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
    const parsed = RunFlowBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(parsed.error);
    }
    const { inputs, options } = parsed.data;
    return {
      kind: 'json',
      status: 201,
      body: await flowlib.runs.executeToNode(
        request.params.flowId,
        request.params.nodeId,
        inputs ?? {},
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
  const parsed = EphemeralBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return badRequest(parsed.error);
  }
  const { definition, inputs, name } = parsed.data;
  return {
    kind: 'json',
    status: 200,
    body: await flowlib.runs.runEphemeral(definition, inputs ?? {}, {
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
