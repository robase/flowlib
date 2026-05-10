/**
 * Tests for `claudeCodeProvider`.
 *
 * The Claude SDK is mocked via `vi.mock` so tests don't reach the
 * network and don't depend on the SDK's exact internal shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claudeCodeProvider, type ApiKeyResolver } from '../provider';
import type { CreateSessionInput } from '../../types';
import type { WorkspaceHandle } from '../../../workspaces/types';
import type { AgentEvent } from '../../../../shared/events';
import type { AgentsAuthContext } from '../../../../shared/auth-context';

// ─── Mock SDK ──────────────────────────────────────────────────────────

interface MockSdkSession {
  runReturns: Array<unknown>; // SDK messages the mock will yield
  runCalls: Array<{ text: string; model?: string }>;
  closed: boolean;
  interrupted: boolean;
  /** Tracks the most recent value passed to setPermissionHandler. */
  permissionHandler?: unknown;
}

const mockSessions: MockSdkSession[] = [];

vi.mock('../runtime', async () => {
  return {
    createClaudeSession: vi.fn(async (_input: unknown) => {
      const state: MockSdkSession = {
        runReturns: [],
        runCalls: [],
        closed: false,
        interrupted: false,
      };
      mockSessions.push(state);
      return {
        sessionId: 'mock-session',
        async *run(turn: { text: string; signal: AbortSignal; model?: string }) {
          state.runCalls.push({ text: turn.text, model: turn.model });
          for (const msg of state.runReturns) {
            if (turn.signal.aborted) {
              return;
            }
            yield msg;
          }
        },
        async interrupt() {
          state.interrupted = true;
        },
        async setPermissionMode() {},
        setPermissionHandler(handler: unknown) {
          state.permissionHandler = handler;
        },
        async close() {
          state.closed = true;
        },
      };
    }),
  };
});

// ─── Test helpers ──────────────────────────────────────────────────────

const FAKE_AUTH: AgentsAuthContext = {
  userId: 'user-1',
  orgId: 'org-1',
  role: 'admin',
  teamIds: [],
};

const FAKE_WORKSPACE: WorkspaceHandle = {
  id: 'ws-1',
  rootPath: '/tmp/agents-test-workspace',
  exec: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn(),
  exists: vi.fn(),
  destroy: vi.fn(),
} as unknown as WorkspaceHandle;

function makeApiKeyResolver(key: string = 'sk-test'): ApiKeyResolver {
  return vi.fn(async () => key);
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) {
    out.push(v);
  }
  return out;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('claudeCodeProvider — factory', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns an AgentProvider with id "claude-code" and the documented capabilities', () => {
    const p = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    expect(p.id).toBe('claude-code');
    expect(p.name).toBe('Claude Code');
    expect(p.capabilities).toMatchObject({
      streaming: true,
      toolUse: true,
      mcpServers: true,
      parallelToolCalls: true,
      fileEdits: true,
      resumableStream: true,
      workspaceRequired: true,
      permissionPrompts: true,
    });
  });

  it('throws when credentialId is missing', () => {
    expect(() =>
      claudeCodeProvider({
        // @ts-expect-error — testing runtime validation
        credentialId: undefined,
        apiKeyResolver: makeApiKeyResolver(),
      }),
    ).toThrow(/credentialId/);
  });

  it('throws when apiKeyResolver is missing', () => {
    expect(() =>
      claudeCodeProvider({
        credentialId: 'cred-1',
        // @ts-expect-error — testing runtime validation
        apiKeyResolver: undefined,
      }),
    ).toThrow(/apiKeyResolver/);
  });
});

describe('validateConfig', () => {
  const provider = claudeCodeProvider({
    credentialId: 'cred-1',
    apiKeyResolver: makeApiKeyResolver(),
  });

  it('accepts an empty config', () => {
    expect(provider.validateConfig({})).toEqual({});
    expect(provider.validateConfig(undefined)).toEqual({});
    expect(provider.validateConfig(null)).toEqual({});
  });

  it('accepts a fully-specified config', () => {
    const cfg = {
      defaultModel: 'claude-sonnet-4-5',
      permissionMode: 'acceptEdits',
      disallowedTools: ['Bash'],
      allowedTools: ['Read', 'Write'],
    };
    expect(provider.validateConfig(cfg)).toEqual(cfg);
  });

  it('rejects invalid defaultModel', () => {
    expect(() => provider.validateConfig({ defaultModel: 42 })).toThrow();
  });

  it('rejects invalid permissionMode', () => {
    expect(() => provider.validateConfig({ permissionMode: 'nope' })).toThrow();
  });

  it('rejects non-array disallowedTools', () => {
    expect(() => provider.validateConfig({ disallowedTools: 'Bash' })).toThrow();
  });

  it('rejects array of non-strings', () => {
    expect(() => provider.validateConfig({ disallowedTools: ['Bash', 5] })).toThrow();
  });
});

describe('createSession', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  it('resolves the API key via the apiKeyResolver and creates a session', async () => {
    const resolver = makeApiKeyResolver('sk-resolved');
    const provider = claudeCodeProvider({
      credentialId: 'cred-anthropic-1',
      apiKeyResolver: resolver,
    });

    const input: CreateSessionInput = {
      auth: FAKE_AUTH,
      config: { defaultModel: 'claude-sonnet-4-5' },
      workspace: FAKE_WORKSPACE,
      systemPrompt: 'You are a helpful agent.',
    };

    const result = await provider.createSession(input);
    expect(result.providerSessionId).toBeTruthy();
    expect(typeof result.providerSessionId).toBe('string');
    expect(resolver).toHaveBeenCalledWith('cred-anthropic-1');
    expect(mockSessions).toHaveLength(1);
  });

  it('throws when the workspace is missing (capabilities.workspaceRequired)', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    await expect(
      provider.createSession({
        auth: FAKE_AUTH,
        config: {},
      } as CreateSessionInput),
    ).rejects.toThrow(/workspace/);
  });

  it('throws when the API key resolver returns empty', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-empty',
      apiKeyResolver: vi.fn(async () => ''),
    });
    await expect(
      provider.createSession({
        auth: FAKE_AUTH,
        config: {},
        workspace: FAKE_WORKSPACE,
      }),
    ).rejects.toThrow(/credential/);
  });
});

describe('prompt', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  async function setup(): Promise<{
    provider: ReturnType<typeof claudeCodeProvider>;
    sessionId: string;
    session: MockSdkSession;
  }> {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const { providerSessionId } = await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });
    return {
      provider,
      sessionId: providerSessionId,
      session: mockSessions[mockSessions.length - 1],
    };
  }

  it('emits text-delta + message-complete + session-end for a simple turn', async () => {
    const { provider, sessionId, session } = await setup();
    session.runReturns = [
      {
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'text', text: 'Hi.' }] },
        uuid: 'u1',
      },
      {
        type: 'result',
        subtype: 'success',
        uuid: 'm1',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];

    const ac = new AbortController();
    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [{ type: 'text', text: 'hello' }],
        abortSignal: ac.signal,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual(['text-delta', 'message-complete', 'session-end']);
    expect(events[2]).toMatchObject({ type: 'session-end', reason: 'completed' });
    expect(session.runCalls).toEqual([{ text: 'hello', model: undefined }]);
  });

  it('forwards model override on PromptInput.model', async () => {
    const { provider, sessionId, session } = await setup();
    session.runReturns = [{ type: 'result', subtype: 'success', uuid: 'r' }];

    const ac = new AbortController();
    await collect(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [{ type: 'text', text: 'go' }],
        model: 'claude-haiku-4-5',
        abortSignal: ac.signal,
      }),
    );

    expect(session.runCalls[0]).toEqual({
      text: 'go',
      model: 'claude-haiku-4-5',
    });
  });

  it('synthesises a file-edit event after a successful Write tool result', async () => {
    const { provider, sessionId, session } = await setup();
    session.runReturns = [
      {
        type: 'assistant',
        message: {
          id: 'msg-1',
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'Write',
              input: { file_path: '/foo.ts', content: 'export const x = 1;' },
            },
          ],
        },
        uuid: 'u1',
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: 'wrote /foo.ts',
            },
          ],
        },
        parent_tool_use_id: 'msg-1',
        uuid: 'u2',
      },
      { type: 'result', subtype: 'success', uuid: 'r' },
    ];

    const ac = new AbortController();
    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [{ type: 'text', text: 'write a file' }],
        abortSignal: ac.signal,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('file-edit');

    const fileEdit = events.find((e) => e.type === 'file-edit');
    expect(fileEdit).toMatchObject({
      type: 'file-edit',
      path: '/foo.ts',
      after: 'export const x = 1;',
    });
  });

  it('does not synthesise file-edit when the tool result is an error', async () => {
    const { provider, sessionId, session } = await setup();
    session.runReturns = [
      {
        type: 'assistant',
        message: {
          id: 'msg-2',
          content: [
            {
              type: 'tool_use',
              id: 'tu-2',
              name: 'Write',
              input: { file_path: '/x.ts', content: 'foo' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-2',
              is_error: true,
              content: 'permission denied',
            },
          ],
        },
        parent_tool_use_id: 'msg-2',
      },
      { type: 'result', subtype: 'success', uuid: 'r' },
    ];

    const ac = new AbortController();
    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [{ type: 'text', text: 'try' }],
        abortSignal: ac.signal,
      }),
    );

    expect(events.find((e) => e.type === 'file-edit')).toBeUndefined();
  });

  it('emits session-end with reason=error when the providerSessionId is unknown', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });

    const ac = new AbortController();
    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: 'does-not-exist',
        parts: [{ type: 'text', text: 'hi' }],
        abortSignal: ac.signal,
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session-end', reason: 'error' });
  });

  it('emits session-end with reason=stopped when abortSignal is already aborted', async () => {
    const { provider, sessionId } = await setup();

    const ac = new AbortController();
    ac.abort();

    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [{ type: 'text', text: 'hello' }],
        abortSignal: ac.signal,
      }),
    );

    // Iterator yields nothing from the SDK (the mock checks abort before
    // each yield), then the provider emits the terminal session-end.
    const terminal = events[events.length - 1];
    expect(terminal).toMatchObject({ type: 'session-end', reason: 'stopped' });
  });

  it('emits session-end with reason=error when no text part is supplied', async () => {
    const { provider, sessionId } = await setup();
    const ac = new AbortController();
    const events = await collect<AgentEvent>(
      provider.prompt({
        providerSessionId: sessionId,
        parts: [],
        abortSignal: ac.signal,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session-end', reason: 'error' });
  });
});

describe('setPermissionHandler', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  it('forwards the handler to the underlying session and returns true', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const { providerSessionId } = await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });

    const handler = vi.fn(async () => ({ behavior: 'allow' as const }));
    const ok = provider.setPermissionHandler(providerSessionId, handler);

    expect(ok).toBe(true);
    expect(mockSessions[0].permissionHandler).toBe(handler);
  });

  it('returns false for unknown session ids', () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const handler = vi.fn(async () => ({ behavior: 'allow' as const }));
    expect(provider.setPermissionHandler('unknown', handler)).toBe(false);
  });

  it('accepts undefined to clear the handler', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const { providerSessionId } = await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });

    const handler = vi.fn(async () => ({ behavior: 'allow' as const }));
    provider.setPermissionHandler(providerSessionId, handler);
    expect(mockSessions[0].permissionHandler).toBe(handler);

    provider.setPermissionHandler(providerSessionId, undefined);
    expect(mockSessions[0].permissionHandler).toBeUndefined();
  });
});

describe('listModels', () => {
  it('returns the built-in model list', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const models = await provider.listModels!();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.id).toMatch(/^claude-code\//);
    }
  });
});

describe('closeSession + shutdown', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  it('closes the underlying SDK session', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    const { providerSessionId } = await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });
    await provider.closeSession!(providerSessionId);
    expect(mockSessions[0].closed).toBe(true);
  });

  it('closeSession is a no-op for unknown ids', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    await expect(provider.closeSession!('unknown')).resolves.toBeUndefined();
  });

  it('shutdown closes every active session', async () => {
    const provider = claudeCodeProvider({
      credentialId: 'cred-1',
      apiKeyResolver: makeApiKeyResolver(),
    });
    await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });
    await provider.createSession({
      auth: FAKE_AUTH,
      config: {},
      workspace: FAKE_WORKSPACE,
    });
    await provider.shutdown!();
    for (const s of mockSessions) {
      expect(s.closed).toBe(true);
    }
  });
});
