/**
 * @flowlib/webhooks — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports.
 * Returns only the frontend plugin — no server-side code is bundled.
 */
import { webhooksFrontend } from './frontend/index';

interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

export function webhooks(_options?: Record<string, unknown>): FlowlibPluginDefinition {
  return {
    id: 'webhooks',
    name: 'Webhooks',
    frontend: webhooksFrontend,
  };
}
