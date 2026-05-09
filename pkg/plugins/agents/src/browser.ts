/**
 * `@flowlib/agents` — Browser Entry Point
 *
 * Resolved via the `browser` condition in `package.json#exports`. Returns
 * only the frontend plugin definition — no server-side modules (schema,
 * provider SDKs, durable-object class) are bundled.
 *
 * In Phase 0 the frontend plugin is a stub: it carries no sidebar
 * entries, routes, or panel tabs. Stream L wires the real
 * `agentsFrontendPlugin` and Stream M ships the chat surface.
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
 * Stub frontend plugin — Stream L will replace it with sidebar entries,
 * routes, and panels. Shape mirrors `FlowlibFrontendPlugin` but is left
 * untyped here so the browser bundle doesn't have to import the UI
 * package's type definitions.
 */
export const agentsFrontendPlugin: {
  id: string;
  name: string;
  /** Phase 1 stream L will populate these arrays. */
  sidebar: unknown[];
  routes: unknown[];
  panelTabs: unknown[];
} = {
  id: 'agents',
  name: 'Agents',
  sidebar: [],
  routes: [],
  panelTabs: [],
};

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
    frontend: options.frontend ?? agentsFrontendPlugin,
  };
}
