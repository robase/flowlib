/**
 * Flow-runs endpoint slice — phase 4 demo.
 *
 * The seven CRUD-shaped routes from the plan, declared as plain data instead
 * of inline `router.post(...)` blocks in each adapter:
 *
 *   POST /flow-runs/list
 *   GET  /flow-runs/:flowRunId
 *   GET  /flows/:flowId/flow-runs
 *   POST /flow-runs/:flowRunId/resume
 *   POST /flow-runs/:flowRunId/cancel
 *   POST /flow-runs/:flowRunId/pause
 *   GET  /flow-runs/:flowRunId/node-executions
 *
 * SSE-streaming and ephemeral routes are deliberately not in this slice —
 * those have framework-specific write loops that don't translate cleanly
 * into a `FlowlibHttpResult` and would distort the metadata shape. They stay
 * adapter-side until the SSE bridge lands.
 *
 * Permissions match the Express adapter's current behaviour exactly. Note
 * that resume/cancel/pause all use `flow-run:cancel`, not `flow-run:update`
 * — the plan doc's older draft claimed `:update` but the production code has
 * always used `:cancel`. Preserving observable behaviour wins.
 */

import type { FlowRun, NodeExecution, QueryOptions } from '@flowlib/core';
import { parsePaginationFromRequest } from '../parsing/pagination';
import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const listFlowRuns = defineEndpoint({
  id: 'flow-runs.list',
  method: 'POST',
  path: '/flow-runs/list',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  async handle({ flowlib, request }) {
    const body = (request.body ?? {}) as QueryOptions<FlowRun>;
    return { kind: 'json', status: 200, body: await flowlib.runs.list(body) };
  },
});

const getFlowRun = defineEndpoint({
  id: 'flow-runs.get',
  method: 'GET',
  path: '/flow-runs/:flowRunId',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.get(request.params.flowRunId),
    };
  },
});

const listFlowRunsByFlow = defineEndpoint<QueryOptions<FlowRun>>({
  id: 'flow-runs.listByFlow',
  method: 'GET',
  path: '/flows/:flowId/flow-runs',
  auth: {
    kind: 'protected',
    permission: 'flow-run:read',
    // Per-flow ACL: pass the flow id so RBAC's `onAuthorize` hook can decide.
    getResource: (request) => ({ type: 'flow', id: request.params.flowId }),
  },
  parse: (request) =>
    parsePaginationFromRequest(request.rawQuery, request.searchParams) as QueryOptions<FlowRun>,
  async handle({ flowlib, request, parsed }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.listByFlowId(request.params.flowId, parsed),
    };
  },
});

const resumeFlowRun = defineEndpoint({
  id: 'flow-runs.resume',
  method: 'POST',
  path: '/flow-runs/:flowRunId/resume',
  auth: { kind: 'protected', permission: 'flow-run:cancel' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.resume(request.params.flowRunId),
    };
  },
});

const cancelFlowRun = defineEndpoint({
  id: 'flow-runs.cancel',
  method: 'POST',
  path: '/flow-runs/:flowRunId/cancel',
  auth: { kind: 'protected', permission: 'flow-run:cancel' },
  async handle({ flowlib, request }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.cancel(request.params.flowRunId),
    };
  },
});

const pauseFlowRun = defineEndpoint({
  id: 'flow-runs.pause',
  method: 'POST',
  path: '/flow-runs/:flowRunId/pause',
  auth: { kind: 'protected', permission: 'flow-run:cancel' },
  async handle({ flowlib, request }) {
    const reason = (request.body as { reason?: string } | undefined)?.reason;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.pause(request.params.flowRunId, reason),
    };
  },
});

const listNodeExecutions = defineEndpoint<QueryOptions<NodeExecution>>({
  id: 'flow-runs.nodeExecutions',
  method: 'GET',
  path: '/flow-runs/:flowRunId/node-executions',
  auth: { kind: 'protected', permission: 'flow-run:read' },
  parse: (request) =>
    parsePaginationFromRequest(
      request.rawQuery,
      request.searchParams,
    ) as QueryOptions<NodeExecution>,
  async handle({ flowlib, request, parsed }) {
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.runs.getNodeExecutions(request.params.flowRunId, parsed),
    };
  },
});

/**
 * Ordered list of flow-run endpoints for adapters to mount.
 *
 * Order matters when a host router uses first-match semantics, but the seven
 * endpoints don't overlap so order is purely aesthetic.
 */
export const flowRunsEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  listFlowRuns,
  getFlowRun,
  listFlowRunsByFlow,
  resumeFlowRun,
  cancelFlowRun,
  pauseFlowRun,
  listNodeExecutions,
] as readonly FlowlibHttpEndpoint<unknown>[];
