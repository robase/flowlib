/**
 * @flowlib/version-control — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports.
 * Returns only the frontend plugin — no server-side code is bundled.
 */
import { vcFrontendPlugin } from './frontend/index';

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

export function versionControl(_options?: Record<string, unknown>): FlowlibPluginDefinition {
  return {
    id: 'version-control',
    name: 'Version Control',
    frontend: vcFrontendPlugin,
  };
}
