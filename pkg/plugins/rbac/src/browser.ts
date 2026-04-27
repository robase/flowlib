/**
 * @flowlib/rbac — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports.
 * Returns only the frontend plugin — no server-side code is bundled.
 */
import { rbacFrontend } from './frontend/index';

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

export function rbac(_options?: Record<string, unknown>): FlowlibPluginDefinition {
  return {
    id: 'rbac',
    name: 'Role-Based Access Control',
    frontend: rbacFrontend,
  };
}
