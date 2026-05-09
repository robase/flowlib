/**
 * Tests for `openCodeProvider`.
 *
 * The opencode HTTP SDK is faked end-to-end so these tests run without a
 * live server. We mock the `@opencode-ai/sdk` module via `vi.mock` and
 * drive a hand-rolled async generator into `event.subscribe().stream` to
 * exercise the SSE → AgentEvent translation path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../../../shared/events';

// ─── Stateful mock SDK ──────────────────────────────────────────────────

interface FakeClient {
  __sentPrompts: Array<{ id: string; body: unknown }>;
  __aborted: string[];
  __deleted: string[];
  __pushEvent: (e: unknown) => void;
  __closeStream: () => void;
  session: {
    create: (opts: { body?: { title?: string }; query?: { directory?: string } }) => Promise<{ id: string }>;
    prompt: (opts: { path: { id: string }; body: unknown; query?: { directory?: string } }) => Promise<unknown>;
    abort: (opts: { path: { id: string } }) => Promise<unknown>;
    delete: (opts: { path: { id: string } }) => Promise<unknown>;
    messages: (opts: { path: { id: string } }) => Promise<unknown>;
  };
  event: {
    subscribe: () => Promise<{ stream: AsyncGenerator<unknown, unknown, unknown> }>;
  };
  provider: { list: () => Promise<unknown> };
}

function createFakeClient(): FakeClient {
  let nextId = 1;
  const sentPrompts: Array<{ id: string; body: unknown }> = [];
  const aborted: string[] = [];
  const deleted: string[] = [];

  // Async event queue powering the SSE iterator.
  const queue: unknown[] = [];
  const waiters: Array<(v: IteratorResult<unknown>) => void> = [];
  let closed = false;

  function push(e: unknown) {
    if (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve({ value: e, done: false });
    } else {
      queue.push(e);
    }
  }
  function close() {
    closed = true;
    while (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve({ value: undefined, done: true });
    }
  }

  async function* stream(): AsyncGenerator<unknown, unknown, unknown> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      if (closed) {return;}
      const result = await new Promise<IteratorResult<unknown>>((resolve) => {
        waiters.push(resolve);
      });
      if (result.done) {return;}
      yield result.value;
    }
  }

  return {
    __sentPrompts: sentPrompts,
    __aborted: aborted,
    __deleted: deleted,
    __pushEvent: push,
    __closeStream: close,
    session: {
      create: async () => ({ id: `session-${nextId++}` }),
      prompt: async (opts) => {
        sentPrompts.push({ id: opts.path.id, body: opts.body });
        // Resolve later — the prompt promise is fired-and-forgotten by
        // the provider, so timing doesn't matter for the iterator path.
        return { info: { id: 'msg' }, parts: [] };
      },
      abort: async (opts) => {
        aborted.push(opts.path.id);
        return {};
      },
      delete: async (opts) => {
        deleted.push(opts.path.id);
        return {};
      },
      messages: async () => ({
        data: [
          {
            info: { id: 'm1', role: 'user', sessionID: 's', time: { created: 1700000000000 } },
            parts: [{ type: 'text', text: 'hi' }],
          },
        ],
      }),
    },
    event: {
      subscribe: async () => ({ stream: stream() }),
    },
    provider: {
      list: async () => ({}),
    },
  };
}

let activeClient: FakeClient = createFakeClient();
const createOpencodeClient = vi.fn(() => activeClient as unknown);

// Embedded mode: createOpencode() returns { client, server } and we
// reuse the same FakeClient as the embedded client.
const createOpencode = vi.fn(async () => ({
  client: activeClient as unknown,
  server: { url: 'http://embedded.local', close: vi.fn() },
}));

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient,
  createOpencode,
}));

// Module under test — imported AFTER vi.mock so the lazy import resolves
// to the fake.
import { openCodeProvider } from '../provider';
import {
  _resetSdkCacheForTests,
  clearClientCache,
  clearEmbeddedCache,
  splitModelId,
  buildToolsMap,
  unwrapSessionId,
  resolveBaseUrl,
} from '../runtime';
import { _resetSessionsForTests } from '../provider';

beforeEach(() => {
  activeClient = createFakeClient();
  createOpencodeClient.mockClear();
  createOpencode.mockClear();
  // Force the runtime to reach back into the mock for each test.
  _resetSdkCacheForTests();
  clearClientCache();
  clearEmbeddedCache();
  _resetSessionsForTests();
});

afterEach(() => {
  activeClient.__closeStream();
});

// ─── Basics ─────────────────────────────────────────────────────────────

describe('openCodeProvider', () => {
  it('returns a provider with the expected id, name, and capabilities', () => {
    const provider = openCodeProvider({ defaultModel: 'anthropic/claude-sonnet-4-7' });
    expect(provider.id).toBe('opencode');
    expect(provider.name).toBe('opencode');
    expect(provider.capabilities).toMatchObject({
      streaming: true,
      toolUse: true,
      mcpServers: true,
      parallelToolCalls: true,
      fileEdits: true,
      workspaceRequired: true,
      permissionPrompts: false,
    });
  });

  it('does NOT load the SDK at module/factory time', () => {
    openCodeProvider({});
    expect(createOpencodeClient).not.toHaveBeenCalled();
  });
});

// ─── validateConfig ────────────────────────────────────────────────────

describe('openCodeProvider.validateConfig', () => {
  const provider = openCodeProvider();

  it('accepts undefined / null / empty config', () => {
    expect(provider.validateConfig(undefined)).toEqual({});
    expect(provider.validateConfig(null)).toEqual({});
    expect(provider.validateConfig({})).toEqual({});
  });

  it('accepts a fully-populated config', () => {
    const cfg = {
      defaultModel: 'openai/gpt-5',
      systemPrompt: 'be helpful',
      defaultDenied: ['Bash'],
      baseUrl: 'http://localhost:9999',
    };
    expect(provider.validateConfig(cfg)).toEqual(cfg);
  });

  it('rejects non-string defaultModel', () => {
    expect(() => provider.validateConfig({ defaultModel: 123 })).toThrowError(/defaultModel/);
  });

  it('rejects non-array defaultDenied', () => {
    expect(() => provider.validateConfig({ defaultDenied: 'Bash' })).toThrowError(/defaultDenied/);
  });

  it('rejects mixed-type defaultDenied', () => {
    expect(() => provider.validateConfig({ defaultDenied: ['ok', 1] })).toThrowError(/defaultDenied/);
  });

  it('rejects non-object root config', () => {
    expect(() => provider.validateConfig('hello')).toThrowError(/object/);
  });
});

// ─── createSession ─────────────────────────────────────────────────────

describe('openCodeProvider.createSession', () => {
  it('creates a session against the resolved baseUrl', async () => {
    const provider = openCodeProvider();
    const out = await provider.createSession({
      auth: { orgId: 'o', userId: 'u', roles: [] } as never,
      config: {},
      extras: { baseUrl: 'http://opencode.local' },
    });
    expect(out.providerSessionId).toMatch(/^session-/);
    expect(createOpencodeClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://opencode.local' }),
    );
  });

  it('threads workspace.metadata.opencodeBaseUrl into the SDK config', async () => {
    const provider = openCodeProvider();
    await provider.createSession({
      auth: { orgId: 'o', userId: 'u', roles: [] } as never,
      config: {},
      workspace: {
        id: 'ws-1',
        rootPath: '/work',
        metadata: { opencodeBaseUrl: 'http://sandbox-7.internal' },
      } as never,
    });
    expect(createOpencodeClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://sandbox-7.internal', directory: '/work' }),
    );
  });

  it('throws when no baseUrl can be resolved', async () => {
    const provider = openCodeProvider();
    delete process.env.OPENCODE_BASE_URL;
    await expect(
      provider.createSession({ auth: {} as never, config: {} }),
    ).rejects.toThrow(/baseUrl/);
  });
});

// ─── prompt — streaming events ─────────────────────────────────────────

describe('openCodeProvider.prompt', () => {
  it('throws session-end:error if asked to prompt an unknown session id', async () => {
    const provider = openCodeProvider();
    const ac = new AbortController();
    const events: AgentEvent[] = [];
    for await (const e of provider.prompt({
      providerSessionId: 'unknown',
      parts: [{ type: 'text', text: 'hi' }],
      abortSignal: ac.signal,
    })) {
      events.push(e);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'session-end', reason: 'error' });
  });

  it('translates SSE events into AgentEvents and terminates on session.idle', async () => {
    const provider = openCodeProvider({ defaultModel: 'anthropic/claude-sonnet-4-7' });
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });

    const ac = new AbortController();

    const collected: AgentEvent[] = [];
    const iterPromise = (async () => {
      for await (const e of provider.prompt({
        providerSessionId: session.providerSessionId,
        parts: [{ type: 'text', text: 'do thing' }],
        abortSignal: ac.signal,
      })) {
        collected.push(e);
      }
    })();

    // Wait one microtask so prompt() can subscribe to the event stream.
    await Promise.resolve();
    await Promise.resolve();

    activeClient.__pushEvent({
      type: 'message.part.updated',
      properties: {
        delta: 'Hello',
        part: {
          id: 'p',
          sessionID: session.providerSessionId,
          messageID: 'm1',
          type: 'text',
          text: '',
        },
      },
    });
    activeClient.__pushEvent({
      type: 'message.updated',
      properties: {
        info: {
          id: 'm1',
          role: 'assistant',
          sessionID: session.providerSessionId,
          time: { created: 1, completed: 2 },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
    });
    activeClient.__pushEvent({
      type: 'session.idle',
      properties: { sessionID: session.providerSessionId },
    });
    activeClient.__closeStream();

    await iterPromise;

    expect(collected.find((e) => e.type === 'text-delta')).toBeTruthy();
    expect(collected.find((e) => e.type === 'message-complete')).toBeTruthy();
    // Prompt was actually issued.
    expect(activeClient.__sentPrompts).toHaveLength(1);
    expect(activeClient.__sentPrompts[0].id).toBe(session.providerSessionId);
  });

  it('drops events from a different session id', async () => {
    const provider = openCodeProvider();
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });

    const ac = new AbortController();
    const collected: AgentEvent[] = [];
    const iterPromise = (async () => {
      for await (const e of provider.prompt({
        providerSessionId: session.providerSessionId,
        parts: [{ type: 'text', text: 'go' }],
        abortSignal: ac.signal,
      })) {
        collected.push(e);
      }
    })();

    await Promise.resolve();
    await Promise.resolve();

    // Belongs to *another* session — must be filtered out.
    activeClient.__pushEvent({
      type: 'message.part.updated',
      properties: {
        delta: 'leak',
        part: {
          id: 'p',
          sessionID: 'session-OTHER',
          messageID: 'mX',
          type: 'text',
          text: '',
        },
      },
    });
    activeClient.__pushEvent({
      type: 'session.idle',
      properties: { sessionID: session.providerSessionId },
    });
    activeClient.__closeStream();
    // Synthesise a lastMessageId so session.idle has something to terminate on.
    activeClient.__pushEvent({
      type: 'message.part.updated',
      properties: {
        delta: 'mine',
        part: {
          id: 'p2',
          sessionID: session.providerSessionId,
          messageID: 'mY',
          type: 'text',
          text: '',
        },
      },
    });

    await iterPromise;
    expect(collected.find((e) => e.type === 'text-delta' && e.text === 'leak')).toBeUndefined();
  });

  it('emits session-end:stopped when abortSignal is already aborted', async () => {
    const provider = openCodeProvider();
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });

    const ac = new AbortController();
    ac.abort();

    const collected: AgentEvent[] = [];
    for await (const e of provider.prompt({
      providerSessionId: session.providerSessionId,
      parts: [{ type: 'text', text: 'go' }],
      abortSignal: ac.signal,
    })) {
      collected.push(e);
    }
    expect(collected).toEqual<AgentEvent[]>([{ type: 'session-end', reason: 'stopped' }]);
  });

  it('honours per-prompt model override over factory default', async () => {
    const provider = openCodeProvider({ defaultModel: 'anthropic/claude-sonnet-4-7' });
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });

    const ac = new AbortController();
    const iterPromise = (async () => {
      for await (const _ of provider.prompt({
        providerSessionId: session.providerSessionId,
        parts: [{ type: 'text', text: 'go' }],
        abortSignal: ac.signal,
        model: 'openai/gpt-5',
      })) {
        // drain
      }
    })();

    await Promise.resolve();
    await Promise.resolve();
    activeClient.__closeStream();
    await iterPromise;

    const sent = activeClient.__sentPrompts[0]?.body as { model?: { providerID: string; modelID: string } };
    expect(sent.model).toEqual({ providerID: 'openai', modelID: 'gpt-5' });
  });

  it('aborts the session and yields a denied tool-result when a denied tool fires', async () => {
    const provider = openCodeProvider({ defaultDenied: ['bash'] });
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });

    const ac = new AbortController();
    const collected: AgentEvent[] = [];
    const iterPromise = (async () => {
      for await (const e of provider.prompt({
        providerSessionId: session.providerSessionId,
        parts: [{ type: 'text', text: 'go' }],
        abortSignal: ac.signal,
      })) {
        collected.push(e);
      }
    })();

    await Promise.resolve();
    await Promise.resolve();

    activeClient.__pushEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'tool-c1',
          sessionID: session.providerSessionId,
          messageID: 'm1',
          type: 'tool',
          callID: 'c1',
          tool: 'bash',
          state: { status: 'running', input: { command: 'echo ok' } },
        },
      },
    });
    activeClient.__closeStream();
    await iterPromise;

    expect(activeClient.__aborted).toContain(session.providerSessionId);
    expect(collected.find((e) => e.type === 'tool-result' && e.isError === true)).toBeTruthy();
    expect(collected.find((e) => e.type === 'session-end' && e.reason === 'stopped')).toBeTruthy();
  });
});

// ─── closeSession / shutdown ───────────────────────────────────────────

describe('openCodeProvider.closeSession + shutdown', () => {
  it('deletes the session and clears local state', async () => {
    const provider = openCodeProvider();
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });
    await provider.closeSession?.(session.providerSessionId);
    expect(activeClient.__deleted).toContain(session.providerSessionId);
  });

  it('shutdown() drops all sessions and the client cache', async () => {
    const provider = openCodeProvider();
    await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });
    await provider.shutdown?.();
    // Subsequent createSession should re-create the client (fresh cache).
    createOpencodeClient.mockClear();
    activeClient = createFakeClient();
    await provider.createSession({
      auth: {} as never,
      config: {},
      extras: { baseUrl: 'http://local' },
    });
    expect(createOpencodeClient).toHaveBeenCalledTimes(1);
  });
});

// ─── runtime helpers ───────────────────────────────────────────────────

describe('runtime helpers', () => {
  describe('splitModelId', () => {
    it('splits provider/model on the first slash', () => {
      expect(splitModelId('anthropic/claude-sonnet-4-7')).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-7',
      });
    });
    it('returns undefined when there is no slash', () => {
      expect(splitModelId('claude')).toBeUndefined();
    });
    it('returns undefined for empty input', () => {
      expect(splitModelId(undefined)).toBeUndefined();
      expect(splitModelId('')).toBeUndefined();
    });
    it('handles models with multiple slashes (provider, rest)', () => {
      expect(splitModelId('openrouter/meta/llama')).toEqual({
        providerID: 'openrouter',
        modelID: 'meta/llama',
      });
    });
  });

  describe('buildToolsMap', () => {
    it('returns undefined when neither set is supplied', () => {
      expect(buildToolsMap({})).toBeUndefined();
    });
    it('whitelist wins over deny list', () => {
      expect(
        buildToolsMap({ enabledTools: ['Read', 'Edit'], extraDenied: ['Bash'] }),
      ).toEqual({ Read: true, Edit: true });
    });
    it('falls back to deny list when no whitelist', () => {
      expect(buildToolsMap({ extraDenied: ['Bash', 'Write'] })).toEqual({
        Bash: false,
        Write: false,
      });
    });
  });

  describe('unwrapSessionId', () => {
    it('reads `id` directly', () => {
      expect(unwrapSessionId({ id: 'x' })).toBe('x');
    });
    it('reads `data.id`', () => {
      expect(unwrapSessionId({ data: { id: 'y' } })).toBe('y');
    });
    it('throws on shape miss', () => {
      expect(() => unwrapSessionId({})).toThrow(/no session id/);
    });
  });

  describe('resolveBaseUrl', () => {
    it('prefers workspace.metadata.opencodeBaseUrl', () => {
      expect(
        resolveBaseUrl({
          workspace: { id: 'w', metadata: { opencodeBaseUrl: 'http://a' } } as never,
          extras: { baseUrl: 'http://b' },
        }),
      ).toBe('http://a');
    });
    it('falls back to extras.baseUrl', () => {
      expect(resolveBaseUrl({ extras: { baseUrl: 'http://b' } })).toBe('http://b');
    });
    it('falls back to OPENCODE_BASE_URL', () => {
      const prev = process.env.OPENCODE_BASE_URL;
      process.env.OPENCODE_BASE_URL = 'http://env';
      try {
        expect(resolveBaseUrl({})).toBe('http://env');
      } finally {
        if (prev === undefined) {delete process.env.OPENCODE_BASE_URL;}
        else {process.env.OPENCODE_BASE_URL = prev;}
      }
    });
    it('honours factoryBaseUrl as a fallback after extras.baseUrl', () => {
      expect(
        resolveBaseUrl({ factoryBaseUrl: 'http://factory' }),
      ).toBe('http://factory');
      // workspace metadata still wins
      expect(
        resolveBaseUrl({
          workspace: { id: 'w', metadata: { opencodeBaseUrl: 'http://ws' } } as never,
          factoryBaseUrl: 'http://factory',
        }),
      ).toBe('http://ws');
    });
    it('throws when no baseUrl resolves', () => {
      const prev = process.env.OPENCODE_BASE_URL;
      delete process.env.OPENCODE_BASE_URL;
      try {
        expect(() => resolveBaseUrl({})).toThrow(/baseUrl/);
      } finally {
        if (prev !== undefined) {process.env.OPENCODE_BASE_URL = prev;}
      }
    });
  });
});

// ─── Factory options: mode + baseUrl ────────────────────────────────────

describe('openCodeProvider factory options', () => {
  it('uses factory baseUrl as a fallback when no workspace / extras supply one', async () => {
    const provider = openCodeProvider({ baseUrl: 'http://factory.local' });
    const out = await provider.createSession({
      auth: {} as never,
      config: {},
    });
    expect(out.providerSessionId).toMatch(/^session-/);
    expect(createOpencodeClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://factory.local' }),
    );
  });

  it('embedded mode: starts createOpencode() and never calls createOpencodeClient', async () => {
    const provider = openCodeProvider({ mode: 'embedded' });
    const session = await provider.createSession({
      auth: {} as never,
      config: {},
      workspace: { id: 'w', rootPath: '/work', metadata: {} } as never,
    });
    expect(session.providerSessionId).toMatch(/^session-/);
    expect(createOpencode).toHaveBeenCalledTimes(1);
    expect(createOpencodeClient).not.toHaveBeenCalled();
  });

  it('embedded mode: caches the server per workspace directory', async () => {
    const provider = openCodeProvider({ mode: 'embedded' });
    await provider.createSession({
      auth: {} as never,
      config: {},
      workspace: { id: 'w', rootPath: '/work', metadata: {} } as never,
    });
    await provider.createSession({
      auth: {} as never,
      config: {},
      workspace: { id: 'w', rootPath: '/work', metadata: {} } as never,
    });
    expect(createOpencode).toHaveBeenCalledTimes(1);
  });

  it('per-session config.mode overrides the factory mode', async () => {
    const provider = openCodeProvider({ mode: 'external', baseUrl: 'http://factory' });
    await provider.createSession({
      auth: {} as never,
      config: { mode: 'embedded' },
    });
    expect(createOpencode).toHaveBeenCalledTimes(1);
    expect(createOpencodeClient).not.toHaveBeenCalled();
  });

  it('shutdown() tears down both client and embedded caches', async () => {
    const provider = openCodeProvider({ mode: 'embedded' });
    const fakeServer = { url: 'http://embedded.local', close: vi.fn() };
    createOpencode.mockImplementationOnce(async () => ({
      client: activeClient as unknown,
      server: fakeServer as never,
    }));
    await provider.createSession({
      auth: {} as never,
      config: {},
      workspace: { id: 'w', rootPath: '/x', metadata: {} } as never,
    });
    await provider.shutdown?.();
    expect(fakeServer.close).toHaveBeenCalled();
  });
});
