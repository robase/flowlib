/**
 * Client for connecting the agent loop to **external** MCP servers
 * (the `agent_mcp_servers` a deployment configures). This is the
 * consumer side — distinct from `tools/flowlib-actions-mcp.ts`, which
 * is the *server* side that exposes Flowlib actions AS an MCP server.
 *
 * A turn loads the session's enabled servers, connects via the factory,
 * lists each server's tools, and wraps them as provider tools the agent
 * can call (see `service/chat-session-host.ts`).
 *
 * The factory is injectable so tests drive the wiring with a fake client
 * and the runtime uses the official `@modelcontextprotocol/sdk` over the
 * Streamable-HTTP (or SSE) transport.
 *
 * **Runtime note**: only `http` (Streamable HTTP) and `sse` transports
 * are supported. `stdio` needs child processes, which don't exist in
 * Workers / Durable Objects, so it throws a clear error.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/** A tool advertised by an MCP server. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema?: Record<string, unknown>;
}

/** Minimal client surface the agent loop needs. Easy to fake in tests. */
export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** The connection details from an `agent_mcp_servers` row. */
export interface McpServerConnection {
  transport: 'stdio' | 'http' | 'sse';
  /** `{ url, headers }` for http/sse. */
  config: Record<string, unknown>;
}

export type McpClientFactory = (server: McpServerConnection) => Promise<McpClient>;

/**
 * Default factory backed by the official MCP SDK. Connects over
 * Streamable HTTP (`http`) or SSE (`sse`). Throws on `stdio`.
 */
export function createDefaultMcpClientFactory(): McpClientFactory {
  return async (server) => {
    if (server.transport === 'stdio') {
      throw new Error(
        'stdio MCP transport is unsupported in this runtime (no child processes) — ' +
          'configure the server with an http or sse endpoint instead.',
      );
    }
    const url = typeof server.config.url === 'string' ? server.config.url : '';
    if (!url) {
      throw new Error('MCP server config is missing a `url`.');
    }
    const headers = (server.config.headers as Record<string, string> | undefined) ?? {};
    const target = new URL(url);
    const transport =
      server.transport === 'sse'
        ? new SSEClientTransport(target, { requestInit: { headers } })
        : new StreamableHTTPClientTransport(target, { requestInit: { headers } });

    const client = new Client({ name: 'flowlib-agents', version: '1.0.0' });
    await client.connect(transport);

    return {
      async listTools() {
        const res = await client.listTools();
        return (res.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }));
      },
      async callTool(name, args) {
        return client.callTool({ name, arguments: args });
      },
      async close() {
        try {
          await client.close();
        } catch {
          // Best-effort — the DO/request teardown reclaims the socket anyway.
        }
      },
    };
  };
}
