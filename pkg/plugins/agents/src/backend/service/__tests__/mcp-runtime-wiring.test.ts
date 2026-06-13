/**
 * Integration: external MCP servers are loaded into a turn.
 *
 * Drives the real `buildSessionContext` with a fake `mcpClientFactory`
 * and a session whose `enabledMcpServerIds` points at a configured
 * server, then asserts:
 *   - the server's tools surface as `mcp.<server>.<tool>` provider tools
 *     carrying the MCP-advertised JSON-Schema parameters
 *   - executing one proxies to the client's `callTool`
 *   - a missing server id is skipped (no tool, no throw)
 *   - a factory/connection failure is skipped (best-effort)
 *
 * The fake factory stands in for the SDK-backed client so the wiring is
 * verified without a live MCP server.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSessionContext,
  createConsoleSessionLogger,
  createInMemoryPromptCache,
  type ChatHostDeps,
  type RepositoriesBag,
} from '../chat-session-host';
import type { McpClient, McpClientFactory, McpServerConnection } from '../../mcp/client';
import type { AgentProvider, ProviderToolDescriptor } from '../../providers/types';

const CAPABILITIES = {
  streaming: true,
  toolUse: true,
  mcpServers: true,
  parallelToolCalls: true,
  fileEdits: false,
  resumableStream: false,
  workspaceRequired: false,
  permissionPrompts: false,
} as AgentProvider['capabilities'];

function fakeProvider(): AgentProvider {
  return {
    id: 'test',
    name: 'Test',
    capabilities: CAPABILITIES,
    validateConfig: (c: unknown) => c as Record<string, unknown>,
    async createSession() {
      return { providerSessionId: 'ps-1' };
    },
    // eslint-disable-next-line require-yield
    async *prompt() {
      return;
    },
  } as unknown as AgentProvider;
}

interface SetupOpts {
  enabledMcpServerIds?: string[];
  servers?: Record<string, { name: string; transport: 'http' | 'sse' | 'stdio'; config: Record<string, unknown> }>;
  factory?: McpClientFactory;
}

async function setup(opts: SetupOpts = {}) {
  const servers = opts.servers ?? {
    'srv-1': { name: 'github', transport: 'http', config: { url: 'https://mcp.example.com' } },
  };
  const callToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const factory: McpClientFactory =
    opts.factory ??
    (async (_server: McpServerConnection): Promise<McpClient> => ({
      async listTools() {
        return [
          {
            name: 'create_issue',
            description: 'Create a GitHub issue',
            inputSchema: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
              additionalProperties: false,
            },
          },
        ];
      },
      async callTool(name, args) {
        callToolCalls.push({ name, args });
        return { content: [{ type: 'text', text: `created: ${String(args.title)}` }] };
      },
      async close() {},
    }));

  const sessionRow = {
    providerId: 'test',
    providerSessionId: 'ps-1',
    orgId: 'org-1',
    model: 'anthropic/claude-sonnet-4-5',
    systemPrompt: null,
    denyList: null,
    enabledTools: null,
    credentialId: null,
    workspaceId: undefined,
    enabledMcpServerIds: opts.enabledMcpServerIds ?? ['srv-1'],
  };

  const repositories = {
    sessions: { findById: async () => sessionRow },
    messages: { append: async () => {} },
    mcpServers: { findById: async (id: string) => servers[id] ?? null },
  } as unknown as RepositoriesBag;

  const deps: ChatHostDeps = {
    sessionId: 's1',
    orgId: 'org-1',
    auth: { userId: 'u1', orgId: 'org-1', role: 'user' } as ChatHostDeps['auth'],
    providers: new Map([['test', fakeProvider()]]),
    repositories,
    emit: () => {},
    logger: createConsoleSessionLogger('[test]'),
    abortSignal: new AbortController().signal,
    promptCache: createInMemoryPromptCache(),
    mcpClientFactory: factory,
  };

  const result = await buildSessionContext(deps);
  if ('error' in result) {
    throw new Error(`buildSessionContext failed: ${result.error.message}`);
  }
  return { ctx: result.context, callToolCalls };
}

describe('MCP runtime tool wiring', () => {
  it('surfaces an enabled server’s tools as namespaced provider tools', async () => {
    const { ctx } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools)).toContain('mcp.github.create_issue');
    const tool = tools['mcp.github.create_issue'];
    expect(tool.description).toContain('Create a GitHub issue');
    // The MCP-advertised input schema becomes the tool's parameters.
    expect((tool.parameters as { required?: string[] }).required).toEqual(['title']);
  });

  it('executing the tool proxies to the client callTool', async () => {
    const { ctx, callToolCalls } = await setup();
    const tools = ctx.providerTools as Record<string, ProviderToolDescriptor>;
    const out = (await tools['mcp.github.create_issue'].execute({ title: 'Bug' }, {})) as {
      content: Array<{ text: string }>;
    };
    expect(callToolCalls).toEqual([{ name: 'create_issue', args: { title: 'Bug' } }]);
    expect(out.content[0].text).toContain('created: Bug');
  });

  it('skips an enabled id that has no configured server (no tool, no throw)', async () => {
    const { ctx } = await setup({ enabledMcpServerIds: ['does-not-exist'] });
    const tools = (ctx.providerTools ?? {}) as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools).filter((k) => k.startsWith('mcp.'))).toEqual([]);
  });

  it('skips a server whose client fails to connect (best-effort)', async () => {
    const failing: McpClientFactory = async () => {
      throw new Error('connection refused');
    };
    const { ctx } = await setup({ factory: failing });
    const tools = (ctx.providerTools ?? {}) as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools).filter((k) => k.startsWith('mcp.'))).toEqual([]);
  });

  it('adds no MCP tools when the session enables none', async () => {
    const { ctx } = await setup({ enabledMcpServerIds: [] });
    const tools = (ctx.providerTools ?? {}) as Record<string, ProviderToolDescriptor>;
    expect(Object.keys(tools).filter((k) => k.startsWith('mcp.'))).toEqual([]);
  });
});
