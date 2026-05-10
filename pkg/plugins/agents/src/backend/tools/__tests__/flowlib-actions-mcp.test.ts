/**
 * Flowlib-actions MCP bridge tests — Stream G.
 *
 * Mocks the `ActionRegistry` and exercises the bridge via its public
 * `listTools()` / `refresh()` / `close()` surface plus the underlying
 * `Server` class's request handlers (we drive them through the
 * in-memory transport pair from the SDK).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';
import { ActionRegistry } from '@flowlib/actions/registry';
import type {
  ActionDefinition,
  AgentToolResult,
  NodeExecutionContext,
  ProviderDef,
} from '@flowlib/action-kit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createFlowlibActionsMcpServer, flattenActionId } from '../flowlib-actions-mcp';
import { createToolOutputStore } from '../tool-output-store';
import { allowAllResolver, type PermissionsResolver } from '../../permissions/types';
import type { WorkspaceHandle } from '../../workspaces/types';

// ─── Test fixtures ──────────────────────────────────────────────────────

const TEST_PROVIDER: ProviderDef = {
  id: 'gmail',
  name: 'Gmail',
  category: 'email',
  icon: 'Mail',
  nodeCategory: 'Integrations',
};

const TRIGGER_PROVIDER: ProviderDef = {
  id: 'triggers',
  name: 'Triggers',
  category: 'utility',
  icon: 'Zap',
  nodeCategory: 'Triggers',
};

function defineTestAction(id: string, overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  const exec = overrides.execute ?? (async () => ({ success: true, output: `ran ${id}` }));
  return {
    id,
    name: id,
    description: `Action ${id}`,
    provider: overrides.provider ?? TEST_PROVIDER,
    params: {
      schema: z.object({}),
      fields: [],
    },
    async execute(params, context) {
      return exec(params, context);
    },
    ...overrides,
  } as ActionDefinition;
}

function makeWorkspace(): WorkspaceHandle & {
  writes: Array<{ path: string; content: string }>;
} {
  const writes: Array<{ path: string; content: string }> = [];
  const handle: WorkspaceHandle = {
    id: 'ws_test',
    metadata: {},
    async exec() {
      throw new Error('not used');
    },
    async readFile() {
      throw new Error('not used');
    },
    async writeFile(path, content) {
      writes.push({ path, content });
    },
    async listFiles() {
      return [];
    },
  };
  return Object.assign(handle, { writes });
}

async function connectClient(server: import('@modelcontextprotocol/sdk/server/index.js').Server) {
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('flattenActionId', () => {
  it('replaces "." with "_"', () => {
    expect(flattenActionId('gmail.send_message')).toBe('gmail_send_message');
    expect(flattenActionId('core.javascript')).toBe('core_javascript');
  });
  it('replaces non-name characters', () => {
    expect(flattenActionId('weird:id?with*chars')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('createFlowlibActionsMcpServer — basic shape', () => {
  let registry: ActionRegistry;
  let workspace: ReturnType<typeof makeWorkspace>;

  beforeEach(() => {
    registry = new ActionRegistry();
    workspace = makeWorkspace();
  });

  it('returns a handle with server / refresh / listTools / close', () => {
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    expect(handle.server).toBeDefined();
    expect(typeof handle.refresh).toBe('function');
    expect(typeof handle.listTools).toBe('function');
    expect(typeof handle.close).toBe('function');
  });

  it('flattens "." in tool names; gmail.send_message → gmail_send_message', async () => {
    registry.register(defineTestAction('gmail.send_message'));
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('gmail_send_message');
  });

  it('skips actions with excludeFromTools=true', async () => {
    registry.register(defineTestAction('gmail.send_message'));
    registry.register(defineTestAction('gmail.flow_only', { excludeFromTools: true }));

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('gmail_send_message');
    expect(names).not.toContain('gmail_flow_only');
  });

  it('skips trigger-provider actions', async () => {
    registry.register(defineTestAction('trigger.cron', { provider: TRIGGER_PROVIDER }));
    registry.register(defineTestAction('gmail.send_message'));

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const tools = await handle.listTools();
    expect(tools.find((t) => t.name.startsWith('trigger_'))).toBeUndefined();
  });

  it('honours the deny list from PermissionsResolver', async () => {
    registry.register(defineTestAction('gmail.send_message'));
    registry.register(defineTestAction('gmail.list_messages'));

    const denyResolver: PermissionsResolver = {
      async getEffectiveDenyList() {
        return new Set(['gmail.list_messages']);
      },
      async isToolAllowed({ toolName }) {
        return toolName !== 'gmail.list_messages';
      },
    };

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: denyResolver,
      workspace,
      resolveDenyListInput: () => ({
        auth: { userId: 'u1', orgId: 'o1', role: 'user', teamIds: [] },
        sessionId: 's1',
      }),
    });
    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('gmail_send_message');
    expect(names).not.toContain('gmail_list_messages');
  });

  it('fail-closed when the resolver throws — surfaces an empty tool list', async () => {
    registry.register(defineTestAction('gmail.send_message'));
    const throwingResolver: PermissionsResolver = {
      async getEffectiveDenyList() {
        throw new Error('boom');
      },
      async isToolAllowed() {
        throw new Error('boom');
      },
    };

    const warn = vi.fn();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: throwingResolver,
      workspace,
      resolveDenyListInput: () => ({
        auth: { userId: 'u1', orgId: 'o1', role: 'user', teamIds: [] },
        sessionId: 's1',
      }),
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });
    const tools = await handle.listTools();
    expect(tools).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failing closed'));
  });

  it('builds JSON Schema input from the action params.fields', async () => {
    const action = defineTestAction('gmail.send_message', {
      params: {
        schema: z.object({
          to: z.string(),
          subject: z.string(),
          body: z.string().optional(),
        }) as unknown as ActionDefinition['params']['schema'],
        fields: [
          { name: 'to', label: 'To', type: 'text', required: true, description: 'Recipient email' },
          { name: 'subject', label: 'Subject', type: 'text', required: true },
          { name: 'body', label: 'Body', type: 'text', required: false },
        ],
      },
    });
    registry.register(action);

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const tools = await handle.listTools();
    const tool = tools.find((t) => t.name === 'gmail_send_message');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema?.type).toBe('object');
    const props = tool?.inputSchema?.properties as Record<
      string,
      { type: string; description?: string }
    >;
    expect(props.to.type).toBe('string');
    expect(props.to.description).toBe('Recipient email');
    expect(tool?.inputSchema?.required).toEqual(['to', 'subject']);
  });
});

describe('createFlowlibActionsMcpServer — hot reload', () => {
  it('rebuilds the tool list when an action is registered after server start', async () => {
    const registry = new ActionRegistry();
    registry.register(defineTestAction('gmail.send_message'));
    const workspace = makeWorkspace();

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });

    let tools = await handle.listTools();
    expect(tools.map((t) => t.name)).toEqual(['gmail_send_message']);

    // Register a new action mid-life.
    registry.register(
      defineTestAction('slack.post_message', {
        provider: { ...TEST_PROVIDER, id: 'slack', name: 'Slack' },
      }),
    );

    tools = await handle.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['gmail_send_message', 'slack_post_message']);
  });

  it('rebuilds the tool list when an action is unregistered', async () => {
    const registry = new ActionRegistry();
    registry.register(defineTestAction('gmail.send_message'));
    registry.register(
      defineTestAction('slack.post_message', {
        provider: { ...TEST_PROVIDER, id: 'slack', name: 'Slack' },
      }),
    );
    const workspace = makeWorkspace();

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });

    let tools = await handle.listTools();
    expect(tools).toHaveLength(2);

    registry.unregister('slack.post_message');

    tools = await handle.listTools();
    expect(tools.map((t) => t.name)).toEqual(['gmail_send_message']);
  });

  it('close() unsubscribes from registry events', async () => {
    const registry = new ActionRegistry();
    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });

    await handle.close();

    // After close, registering a new action shouldn't throw via the
    // unsubscribed listener. We can't directly observe the listener
    // count without poking internals, but we can verify the call
    // doesn't reject.
    registry.register(defineTestAction('gmail.send_message'));
  });
});

describe('createFlowlibActionsMcpServer — name-collision handling', () => {
  it('warns and suffixes when two action ids flatten to the same name', async () => {
    const registry = new ActionRegistry();
    // Two different provider ids that both flatten to "weird_prefix".
    registry.register(defineTestAction('weird.prefix'));
    registry.register(defineTestAction('weird_prefix'));

    const warn = vi.fn();
    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });

    const tools = await handle.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('weird_prefix');
    expect(names).toContain('weird_prefix_1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('collision'));
  });
});

describe('createFlowlibActionsMcpServer — tool execution', () => {
  it('routes calls through executeActionAsTool', async () => {
    const registry = new ActionRegistry();
    const exec = vi.fn(
      async (_params: Record<string, unknown>) =>
        ({ success: true, output: 'ok' }) as AgentToolResult,
    );
    registry.register(
      defineTestAction('gmail.send_message', {
        execute: exec as unknown as ActionDefinition['execute'],
        params: {
          schema: z.object({ to: z.string() }) as unknown as ActionDefinition['params']['schema'],
          fields: [{ name: 'to', label: 'To', type: 'text', required: true }],
        },
      }),
    );

    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'gmail_send_message',
      arguments: { to: 'a@b.com' },
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[0]).toMatchObject({ to: 'a@b.com' });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe('text');
    expect(content[0]?.text).toBe('ok');
    expect(result.isError).not.toBe(true);

    await handle.close();
    await client.close();
  });

  it('returns isError when the action reports failure', async () => {
    const registry = new ActionRegistry();
    registry.register(
      defineTestAction('gmail.send_message', {
        execute: async () => ({ success: false, error: 'boom' }),
      }),
    );
    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'gmail_send_message',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain('boom');

    await handle.close();
    await client.close();
  });

  it('returns an error result for unknown / filtered tool names', async () => {
    const registry = new ActionRegistry();
    registry.register(defineTestAction('gmail.send_message'));
    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'does_not_exist',
      arguments: {},
    });
    expect(result.isError).toBe(true);

    await handle.close();
    await client.close();
  });

  it('truncates large outputs via the tool-output store and persists the rest to the workspace', async () => {
    const registry = new ActionRegistry();
    const big = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join('\n');
    registry.register(
      defineTestAction('gmail.send_message', {
        execute: async () => ({ success: true, output: big }),
      }),
    );
    const workspace = makeWorkspace();
    const store = createToolOutputStore({ budget: { lines: 5, bytes: 10_000 } });

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      toolOutputStore: store,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'gmail_send_message',
      arguments: {},
    });

    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain('line-1');
    expect(content[0]?.text).toContain('line-5');
    expect(content[0]?.text).not.toContain('line-6');
    expect(content[0]?.text).toContain('[output truncated');
    expect(content[0]?.text).toContain('.flowlib/tool-outputs/');

    expect(workspace.writes).toHaveLength(1);
    expect(workspace.writes[0].content).toBe(big);

    await handle.close();
    await client.close();
  });
});

describe('createFlowlibActionsMcpServer — workspace-less mode', () => {
  it('registers read_tool_output as a fallback when no workspace is supplied', async () => {
    const registry = new ActionRegistry();
    registry.register(defineTestAction('gmail.send_message'));
    const store = createToolOutputStore({ budget: { lines: 2, bytes: 10_000 } });

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      // No workspace → read_tool_output gets injected.
      toolOutputStore: store,
    });

    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('gmail_send_message');
    expect(names).toContain('read_tool_output');

    const readTool = tools.find((t) => t.name === 'read_tool_output');
    expect(readTool?.inputSchema?.required).toEqual(['toolCallId']);
  });

  it('does NOT register read_tool_output when a workspace is attached', async () => {
    const registry = new ActionRegistry();
    registry.register(defineTestAction('gmail.send_message'));
    const workspace = makeWorkspace();
    const store = createToolOutputStore({ budget: { lines: 2, bytes: 10_000 } });

    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      toolOutputStore: store,
    });

    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('read_tool_output');
  });

  it('read_tool_output returns the slice of a previously-truncated output', async () => {
    const registry = new ActionRegistry();
    const big = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join('\n');
    registry.register(
      defineTestAction('gmail.send_message', {
        execute: async () => ({ success: true, output: big }),
      }),
    );

    const store = createToolOutputStore({ budget: { lines: 5, bytes: 10_000 } });
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      toolOutputStore: store,
    });
    const client = await connectClient(handle.server);

    // First call truncates; metadata carries the toolCallId we need to
    // pass to read_tool_output.
    const callResult = await client.callTool({
      name: 'gmail_send_message',
      arguments: {},
    });
    const meta = (callResult._meta ?? {}) as Record<string, unknown>;
    const toolCallId = meta['flowlib.toolOutput.toolCallId'] as string | undefined;
    expect(typeof toolCallId).toBe('string');
    expect(meta['flowlib.toolOutput.truncated']).toBe(true);

    // Second call: read_tool_output with offset/limit.
    const sliceResult = await client.callTool({
      name: 'read_tool_output',
      arguments: { toolCallId, offset: 10, limit: 3 },
    });
    expect(sliceResult.isError).not.toBe(true);
    const content = (sliceResult.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe('line-11\nline-12\nline-13');

    // Third call: grep filter.
    const grepResult = await client.callTool({
      name: 'read_tool_output',
      arguments: { toolCallId, grep: 'line-99' },
    });
    const grepContent = (grepResult.content ?? []) as Array<{ type: string; text?: string }>;
    expect(grepContent[0]?.text).toBe('line-99');

    await handle.close();
    await client.close();
  });

  it('read_tool_output returns an error for unknown toolCallId', async () => {
    const registry = new ActionRegistry();
    const store = createToolOutputStore();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      toolOutputStore: store,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'read_tool_output',
      arguments: { toolCallId: 'nope' },
    });
    expect(result.isError).toBe(true);
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain('no stored output');

    await handle.close();
    await client.close();
  });

  it('read_tool_output rejects calls without a toolCallId', async () => {
    const registry = new ActionRegistry();
    const store = createToolOutputStore();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      toolOutputStore: store,
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'read_tool_output',
      arguments: {},
    });
    expect(result.isError).toBe(true);

    await handle.close();
    await client.close();
  });
});

describe('createFlowlibActionsMcpServer — credential plumbing', () => {
  it('passes credentialId through staticParams to executeActionAsTool', async () => {
    const registry = new ActionRegistry();

    // Action that "fetches" a credential via context.functions.getCredential
    // and echoes the access token back as output. Mimics the Gmail/Slack
    // OAuth2 path through executeActionAsTool.
    registry.register(
      defineTestAction('gmail.send_message', {
        credential: { required: true, oauth2Provider: 'gmail' },
        async execute(_params, context) {
          const tok = context.credential?.config?.accessToken;
          return { success: true, output: `bearer:${tok}` };
        },
      }),
    );

    const getCredential = vi.fn(async (_id: string) => ({
      id: 'cred_1',
      type: 'gmail',
      config: { accessToken: 'tok-xyz' },
    }));

    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      callHooks: () => ({
        buildNodeContext: () =>
          ({
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            nodeId: 'n',
            flowId: 'f',
            flowVersion: 0,
            flowRunId: 'fr',
            globalConfig: {},
            flowParams: {},
            flowInputs: {},
            edges: [],
            nodes: [],
            skippedNodeIds: new Set(),
            functions: { getCredential },
          }) as unknown as NodeExecutionContext,
        staticParams: { credentialId: 'cred_1' },
      }),
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'gmail_send_message',
      arguments: { to: 'a@b.com' },
    });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe('bearer:tok-xyz');
    expect(getCredential).toHaveBeenCalledWith('cred_1');

    await handle.close();
    await client.close();
  });

  it('returns a structured "missing credential" error when getCredential rejects', async () => {
    const registry = new ActionRegistry();
    registry.register(
      defineTestAction('gmail.send_message', {
        credential: { required: true, oauth2Provider: 'gmail' },
        async execute() {
          return { success: true, output: 'should not reach' };
        },
      }),
    );

    const getCredential = vi.fn(async () => {
      throw new Error('no credential of type gmail');
    });

    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      callHooks: () => ({
        buildNodeContext: () =>
          ({
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            nodeId: 'n',
            flowId: 'f',
            flowVersion: 0,
            flowRunId: 'fr',
            globalConfig: {},
            flowParams: {},
            flowInputs: {},
            edges: [],
            nodes: [],
            skippedNodeIds: new Set(),
            functions: { getCredential },
          }) as unknown as NodeExecutionContext,
        staticParams: { credentialId: 'cred_missing' },
      }),
    });
    const client = await connectClient(handle.server);

    const result = await client.callTool({
      name: 'gmail_send_message',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toContain('Failed to fetch credential');
    expect(content[0]?.text).toContain('no credential of type gmail');

    await handle.close();
    await client.close();
  });
});

describe('createFlowlibActionsMcpServer — credential capability filter', () => {
  it('skips actions whose required credential the user does not have', async () => {
    const registry = new ActionRegistry();
    registry.register(
      defineTestAction('gmail.send_message', {
        credential: { required: true, oauth2Provider: 'gmail' },
      }),
    );
    registry.register(
      defineTestAction('open.tool', {
        provider: { ...TEST_PROVIDER, id: 'open', name: 'Open' },
      }),
    );

    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      credentialsLister: {
        async list() {
          return []; // user has no credentials
        },
      },
    });

    const tools = await handle.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('open_tool');
    expect(names).not.toContain('gmail_send_message');
  });

  it('keeps actions when the required credential is present', async () => {
    const registry = new ActionRegistry();
    registry.register(
      defineTestAction('gmail.send_message', {
        credential: { required: true, oauth2Provider: 'gmail' },
      }),
    );
    const workspace = makeWorkspace();
    const handle = createFlowlibActionsMcpServer({
      registry,
      userId: 'u1',
      sessionId: 's1',
      permissions: allowAllResolver,
      workspace,
      credentialsLister: {
        async list() {
          return [{ id: 'cred_1', type: 'gmail' }];
        },
      },
    });

    const tools = await handle.listTools();
    expect(tools.map((t) => t.name)).toContain('gmail_send_message');
  });
});
