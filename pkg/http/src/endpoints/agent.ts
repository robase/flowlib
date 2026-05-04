/**
 * Agent endpoint slice.
 *
 *   GET /agent/tools
 *
 * Returns the AI agent's tool catalogue (every registered action exposed as
 * an `AgentToolDefinition`). Ships a `Cache-Control: public, max-age=3600`
 * header — the catalogue is process-static, so far-future caching is safe.
 *
 * Permission: `flow:read` (matches the previous Express enforcement; the
 * catalogue is the same for any reader).
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const agentTools = defineEndpoint({
  id: 'agent.tools',
  method: 'GET',
  path: '/agent/tools',
  auth: { kind: 'protected', permission: 'flow:read' },
  async handle({ flowlib }) {
    return {
      kind: 'json',
      status: 200,
      body: flowlib.agent.getTools(),
      headers: { 'Cache-Control': 'public, max-age=3600' },
    };
  },
});

export const agentEndpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  agentTools,
] as readonly FlowlibHttpEndpoint<unknown>[];
