/**
 * MCP Server factory — creates and configures the McpServer with all tools,
 * resources, and prompts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlowlibClient } from './client/types';
import { registerFlowTools } from './tools/flow-tools';
import { registerVersionTools } from './tools/version-tools';
import { registerRunTools } from './tools/run-tools';
import { registerDebugTools } from './tools/debug-tools';
import { registerCredentialTools } from './tools/credential-tools';
import { registerTriggerTools } from './tools/trigger-tools';
import { registerNodeTools } from './tools/node-tools';
import { registerAgentTools } from './tools/agent-tools';
import { registerResources } from './resources/index';
import { registerPrompts } from './prompts/index';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../shared/package-info';
import type { AuditLogger } from './audit';

export interface McpServerOptions {
  /**
   * Audit logger — when supplied, every tool invocation is wrapped with
   * timing + success/error instrumentation.
   */
  auditLogger?: AuditLogger;
  /**
   * Session context callback — used to tag audit entries with session id /
   * user id. Returns the context for the "current" request; the SDK routes
   * all tool calls through the server, so the plugin endpoint can stash the
   * context before dispatching.
   */
  getSessionContext?: () => { sessionId?: string; userId?: string; userRole?: string } | undefined;
}

export function createMcpServer(client: FlowlibClient, options: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Install the audit wrapper before any tools register. Tool files call
  // `server.registerTool(name, config, cb)` — we intercept `registerTool` so
  // the wrapped cb emits audit logs around every invocation.
  if (options.auditLogger) {
    installAuditWrapper(server, options.auditLogger, options.getSessionContext);
  }

  // Register all tools
  registerFlowTools(server, client);
  registerVersionTools(server, client);
  registerRunTools(server, client);
  registerDebugTools(server, client);
  registerCredentialTools(server, client);
  registerTriggerTools(server, client);
  registerNodeTools(server, client);
  registerAgentTools(server, client);

  // Register resources and prompts
  registerResources(server, client);
  registerPrompts(server, client);

  return server;
}

type RegisterToolFn = (
  name: string,
  config: { description?: string; inputSchema?: unknown; [k: string]: unknown },
  cb: (...args: unknown[]) => unknown,
) => unknown;

function installAuditWrapper(
  server: McpServer,
  auditLogger: AuditLogger,
  getSessionContext?: McpServerOptions['getSessionContext'],
): void {
  const original = (server as unknown as { registerTool: RegisterToolFn }).registerTool.bind(
    server,
  );

  const wrapped: RegisterToolFn = (name, config, cb) => {
    const instrumented = async (...args: unknown[]) => {
      const ctx = getSessionContext?.();
      const timer = auditLogger.startTimer(name, ctx);
      try {
        const result = await cb(...args);
        timer.finish({ status: 'success' });
        return result;
      } catch (err) {
        timer.finish({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
    return original(name, config, instrumented);
  };

  (server as unknown as { registerTool: RegisterToolFn }).registerTool = wrapped;
}
