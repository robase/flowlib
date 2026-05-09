/**
 * `@flowlib/agents` — Browser Entry Point
 *
 * Resolved via the `browser` condition in `package.json#exports`. Returns
 * only the frontend plugin definition — no server-side modules (schema,
 * provider SDKs, durable-object class) are bundled.
 *
 * Stream L wires the real `agentsFrontendPlugin` (sidebar entry +
 * /agents listing/form/detail routes + AgentsApiProvider). Stream M
 * ships the chat surface as a separate plugin definition that
 * consumers compose alongside this one.
 *
 * Importing `agents` from this module is safe in any browser bundler:
 * Vite, webpack, esbuild — none of them try to resolve Node-only
 * dependencies through this path.
 */

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

interface AgentsBrowserOptions {
  /** Reserved for parity with the backend factory. */
  staticOrgId?: string;
  orgScope?: 'optional' | 'required';
  /** Browser-side hosts may pre-supply a frontend plugin definition. */
  frontend?: unknown;
  [key: string]: unknown;
}

/**
 * Real frontend plugin — Stream L wires sidebar, routes (/agents,
 * /agents/new, /agents/:agentId) and the `AgentsApiProvider`. Stream M
 * ships the chat surface as a separate plugin definition that
 * consumers compose alongside this one.
 */
export { agentsFrontendPlugin } from './frontend/plugins/agentsFrontendPlugin';

import { agentsFrontendPlugin as defaultAgentsFrontend } from './frontend/plugins/agentsFrontendPlugin';

/**
 * Browser-side `agents()` factory mirror.
 *
 * Returns the same `FlowlibPluginDefinition` shape as the backend
 * factory, but only the `frontend` field is populated. The backend's
 * server-side bundle handles the real init.
 */
export function agents(options: AgentsBrowserOptions = {}): FlowlibPluginDefinition {
  return {
    id: 'agents',
    name: 'Agents',
    frontend: options.frontend ?? defaultAgentsFrontend,
  };
}
