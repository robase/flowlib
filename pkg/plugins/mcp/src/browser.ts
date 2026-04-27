/**
 * @flowlib/mcp — Browser Entry Point
 *
 * Resolved via the `browser` condition in package.json exports.
 * MCP is a server-side only plugin — no frontend UI is bundled.
 */

interface InvectPluginDefinition {
  id: string;
  name?: string;
  backend?: unknown;
  frontend?: unknown;
}

export function mcp(_options?: Record<string, unknown>): InvectPluginDefinition {
  return {
    id: 'mcp',
    name: 'MCP',
  };
}
