/**
 * @flowlib/mcp — Plugin entry point
 *
 * Exports the `mcp()` factory that creates an FlowlibPluginDefinition providing
 * MCP (Model Context Protocol) endpoints for AI coding agents.
 */

import { randomUUID } from 'node:crypto';
import type {
  FlowlibInstance,
  FlowlibPlugin,
  FlowlibPluginDefinition,
  FlowlibPluginContext,
} from '@flowlib/core';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpPluginOptions } from '../shared/types';
import { DirectClient } from './client/direct-client';
import { createMcpServer } from './mcp-server';
import { SessionManager } from './session-manager';
import { AuditLogger } from './audit';
import { mapAuthInfoToIdentity } from './auth';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../shared/package-info';

const MCP_SESSION_HEADER = 'mcp-session-id';

/**
 * Create the MCP plugin.
 *
 * When registered with Flowlib, this plugin mounts Streamable HTTP endpoints
 * at `/plugins/mcp/` that implement the Model Context Protocol. MCP clients
 * (Claude Desktop, VS Code Copilot, Cursor, etc.) connect to these endpoints.
 *
 * @example
 * ```typescript
 * import { mcp } from '@flowlib/mcp';
 *
 * defineConfig({
 *   plugins: [mcp()],
 * });
 * ```
 */
export function mcp(options: McpPluginOptions = {}): FlowlibPluginDefinition {
  return {
    id: 'mcp',
    name: 'Model Context Protocol',
    backend: _mcpBackendPlugin(options),
  };
}

function _mcpBackendPlugin(options: McpPluginOptions = {}): FlowlibPlugin {
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  const sessionManager = new SessionManager(sessionTtlMs);
  let auditLogger: AuditLogger | undefined;

  // Per-request session context — the transport serialises handling per
  // message so a plain variable is safe as long as we set it before the
  // message reaches the McpServer and clear it after. Tools read it via
  // `getSessionContext` passed to `createMcpServer`.
  let currentSessionCtx: { sessionId?: string; userId?: string; userRole?: string } | undefined;

  return {
    id: 'mcp',
    name: 'Model Context Protocol',

    settings: {
      namespace: 'mcp',
      label: 'Model Context Protocol',
      description:
        'MCP plugin settings. Editable values hot-reload. `audit.persist` is bound at startup because it gates a database table writer — change in flowlib.config.ts and restart.',
      fields: [
        {
          key: 'mcp.sessionTtlMs',
          label: 'Session TTL (ms)',
          description:
            'How long an idle MCP session is kept alive. Lower TTL frees resources faster; higher TTL keeps long-running clients connected.',
          type: 'number',
          defaultValue: options.sessionTtlMs ?? 30 * 60 * 1000,
        },
        {
          key: 'mcp.audit.enabled',
          label: 'Audit logging enabled',
          description: 'When off, MCP tool invocations are not logged.',
          type: 'boolean',
          defaultValue: options.audit?.enabled ?? true,
        },
        {
          key: 'mcp.audit.logLevel',
          label: 'Audit log level',
          description: 'Severity used for audit log entries.',
          type: 'select',
          options: [
            { value: 'debug', label: 'Debug' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warn' },
          ],
          defaultValue: options.audit?.logLevel ?? 'info',
        },
        {
          key: 'mcp.audit.persist',
          label: 'Persist audit logs to DB',
          description:
            'Configured in flowlib.config.ts. Toggling this requires restart because it gates the database writer.',
          type: 'boolean',
          readOnly: true,
          defaultValue: options.audit?.persist ?? false,
        },
      ],
    },

    init(ctx: FlowlibPluginContext) {
      auditLogger = new AuditLogger(ctx.logger, options.audit);

      ctx.store.set('sessionManager', sessionManager);
      ctx.store.set('auditLogger', auditLogger);

      sessionManager.startCleanup();

      // Stash a post-init applier — overlays persisted settings on top of
      // the constructor defaults and subscribes to onChange.
      ctx.store.set('__settingsApplier', async (flowlib: FlowlibInstance) => {
        const persistedTtl = await flowlib.settings.get<number>('mcp.sessionTtlMs');
        if (typeof persistedTtl === 'number' && persistedTtl > 0) {
          sessionManager.setTtlMs(persistedTtl);
        }

        const persistedEnabled = await flowlib.settings.get<boolean>('mcp.audit.enabled');
        if (typeof persistedEnabled === 'boolean' && auditLogger) {
          auditLogger.setEnabled(persistedEnabled);
        }
        const persistedLogLevel = await flowlib.settings.get<'debug' | 'info' | 'warn'>(
          'mcp.audit.logLevel',
        );
        if (
          (persistedLogLevel === 'debug' ||
            persistedLogLevel === 'info' ||
            persistedLogLevel === 'warn') &&
          auditLogger
        ) {
          auditLogger.setLogLevel(persistedLogLevel);
        }

        flowlib.settings.onChange('mcp', (event) => {
          if (event.type !== 'set') {
            return;
          }
          switch (event.key) {
            case 'mcp.sessionTtlMs':
              if (typeof event.value === 'number') {
                sessionManager.setTtlMs(event.value);
              }
              break;
            case 'mcp.audit.enabled':
              if (typeof event.value === 'boolean' && auditLogger) {
                auditLogger.setEnabled(event.value);
              }
              break;
            case 'mcp.audit.logLevel':
              if (
                (event.value === 'debug' || event.value === 'info' || event.value === 'warn') &&
                auditLogger
              ) {
                auditLogger.setLogLevel(event.value);
              }
              break;
          }
        });
      });

      ctx.logger.info(
        `MCP plugin initialized (session TTL: ${sessionTtlMs / 1000}s, audit: ${
          options.audit?.enabled !== false ? 'on' : 'off'
        })`,
      );
    },

    endpoints: [
      // Streamable HTTP endpoints. The SDK's WebStandard transport handles
      // POST (messages), GET (SSE stream) and DELETE (session close) via the
      // same handleRequest() entry point — method routing is internal.
      {
        method: 'POST',
        path: '/mcp',
        handler: async (ctx) => {
          const identity = ctx.identity ?? mapAuthInfoToIdentity(ctx.headers);
          const sessionCtx = {
            sessionId: pickHeader(ctx.headers, MCP_SESSION_HEADER),
            userId: identity?.id,
            userRole: identity?.role,
          };

          const transport = await resolveTransportForPost(
            ctx.request,
            ctx.body,
            sessionManager,
            () =>
              createMcpServer(new DirectClient(ctx.getFlowlib()), {
                auditLogger,
                getSessionContext: () => currentSessionCtx,
              }),
          );

          currentSessionCtx = sessionCtx;
          try {
            const response = await transport.handleRequest(ctx.request, {
              parsedBody: ctx.body,
            });
            return response;
          } finally {
            currentSessionCtx = undefined;
          }
        },
      },
      {
        method: 'GET',
        path: '/mcp',
        handler: async (ctx) => {
          const sessionId = pickHeader(ctx.headers, MCP_SESSION_HEADER);
          if (!sessionId) {
            return {
              status: 400,
              body: { error: 'Missing Mcp-Session-Id header' },
            };
          }
          const entry = sessionManager.touch(sessionId);
          if (!entry) {
            return {
              status: 404,
              body: { error: `Unknown MCP session ${sessionId}` },
            };
          }
          return await entry.transport.handleRequest(ctx.request);
        },
      },
      {
        method: 'DELETE',
        path: '/mcp',
        handler: async (ctx) => {
          const sessionId = pickHeader(ctx.headers, MCP_SESSION_HEADER);
          if (!sessionId) {
            return {
              status: 400,
              body: { error: 'Missing Mcp-Session-Id header' },
            };
          }
          const entry = sessionManager.get(sessionId);
          if (!entry) {
            return { status: 204, body: '' };
          }
          const response = await entry.transport.handleRequest(ctx.request);
          await sessionManager.delete(sessionId);
          return response;
        },
      },

      // Health check / server info
      {
        method: 'GET',
        path: '/mcp/info',
        handler: async () => {
          return {
            status: 200,
            body: {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {
                tools: true,
                resources: true,
                prompts: true,
              },
              sessions: sessionManager.size,
            },
          };
        },
        isPublic: true,
      },
    ],

    async shutdown() {
      await sessionManager.closeAll();
    },
  };
}

type PluginHeaders = Record<string, string | string[] | undefined>;

function pickHeader(headers: PluginHeaders, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

/**
 * Resolve the transport to handle a POST /mcp request.
 *
 * - If the request carries a Mcp-Session-Id for a known session, return that
 *   session's transport.
 * - Otherwise (new session) create a transport + server pair and register the
 *   session id in the manager once the SDK generates it.
 */
async function resolveTransportForPost(
  request: Request,
  body: unknown,
  sessionManager: SessionManager,
  createServer: () => ReturnType<typeof createMcpServer>,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const sessionId = request.headers.get('mcp-session-id') ?? undefined;

  if (sessionId) {
    const existing = sessionManager.touch(sessionId);
    if (existing) {
      return existing.transport;
    }
    // Unknown session id — fall through and let the transport 404 it.
  }

  // New session (likely an `initialize` request). Build a fresh transport +
  // server pair; the SDK calls `onsessioninitialized` once it has generated
  // the session id.
  void body;
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessionManager.set(sid, { transport, server });
    },
    onsessionclosed: (sid) => {
      void sessionManager.delete(sid);
    },
  });
  await server.connect(transport);
  return transport;
}

export type { McpPluginOptions } from '../shared/types';
