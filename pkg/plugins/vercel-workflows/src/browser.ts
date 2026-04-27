/**
 * @flowlib/vercel-workflows — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports.
 * Returns only the frontend plugin — no server-side code is bundled.
 */
import { vercelWorkflowsFrontendPlugin } from './frontend/index';

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

export function vercelWorkflowsPlugin(_options?: Record<string, unknown>): FlowlibPluginDefinition {
  return {
    id: 'vercel-workflows',
    name: 'Vercel Workflows',
    frontend: vercelWorkflowsFrontendPlugin,
  };
}
