/**
 * Tests for `ProviderRegistry` + `registerProviders`.
 */
import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, createProviderRegistry } from '../registry';
import { registerProviders } from '../register';
import type { AgentProvider } from '../types';
import type { PluginContext } from '../../plugin-context';

// ─── Test fixtures ─────────────────────────────────────────────────────

function makeProvider(id: string, name: string = id): AgentProvider {
  return {
    id,
    name,
    capabilities: {
      streaming: false,
      toolUse: false,
      mcpServers: false,
      parallelToolCalls: false,
      fileEdits: false,
      resumableStream: false,
      workspaceRequired: false,
      permissionPrompts: false,
    },
    validateConfig: (config) => (config ?? {}) as Record<string, unknown>,
    createSession: async () => ({ providerSessionId: `${id}-session` }),
    // eslint-disable-next-line require-yield
    async *prompt() {
      // No events.
    },
  };
}

function makePluginContext(): PluginContext {
  const logs: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const log = (level: string) =>
    (msg: string, meta?: unknown) => {
      logs.push({ level, msg, meta });
    };
  const ctx = {
    options: { staticOrgId: 'default-org', orgScope: 'optional' as const },
    flowlib: {} as never,
    actionRegistry: {} as never,
    registries: {
      providers: new Map<string, AgentProvider>(),
      workspaces: new Map(),
    },
    logger: {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    },
  } as unknown as PluginContext & { __logs: typeof logs };
  (ctx as { __logs: typeof logs }).__logs = logs;
  return ctx;
}

// ─── ProviderRegistry ──────────────────────────────────────────────────

describe('ProviderRegistry', () => {
  it('registers a provider and resolves it via get()', () => {
    const registry = new ProviderRegistry();
    const p = makeProvider('claude-code');
    registry.register(p);
    expect(registry.get('claude-code')).toBe(p);
    expect(registry.has('claude-code')).toBe(true);
  });

  it('throws when registering a duplicate id', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('claude-code'));
    expect(() => registry.register(makeProvider('claude-code', 'duplicate'))).toThrowError(
      /already registered/,
    );
  });

  it('throws on get() for unknown id, listing known ids', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('claude-code'));
    registry.register(makeProvider('opencode'));
    let err: unknown;
    try {
      registry.get('does-not-exist');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/unknown provider id "does-not-exist"/);
    expect(msg).toMatch(/claude-code/);
    expect(msg).toMatch(/opencode/);
  });

  it('throws on get() with "(none)" hint when no providers registered', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get('claude-code')).toThrowError(/\(none\)/);
  });

  it('has() returns false for unknown id', () => {
    const registry = new ProviderRegistry();
    expect(registry.has('anything')).toBe(false);
  });

  it('list() returns providers in registration order', () => {
    const registry = new ProviderRegistry();
    const a = makeProvider('a');
    const b = makeProvider('b');
    const c = makeProvider('c');
    registry.register(a);
    registry.register(b);
    registry.register(c);
    expect(registry.list()).toEqual([a, b, c]);
  });

  it('shares state with a backing Map when one is supplied', () => {
    const backing = new Map<string, AgentProvider>();
    const registry = new ProviderRegistry(backing);
    const p = makeProvider('claude-code');
    registry.register(p);
    expect(backing.get('claude-code')).toBe(p);
    expect(backing.size).toBe(1);
  });

  it('observes providers added directly to the backing Map (read-through)', () => {
    const backing = new Map<string, AgentProvider>();
    const registry = new ProviderRegistry(backing);
    const p = makeProvider('claude-code');
    backing.set('claude-code', p);
    expect(registry.has('claude-code')).toBe(true);
    expect(registry.get('claude-code')).toBe(p);
  });

  it('createProviderRegistry() factory mirrors `new ProviderRegistry`', () => {
    const backing = new Map<string, AgentProvider>();
    const registry = createProviderRegistry(backing);
    expect(registry).toBeInstanceOf(ProviderRegistry);
    registry.register(makeProvider('claude-code'));
    expect(backing.size).toBe(1);
  });
});

// ─── registerProviders(ctx, providers) ─────────────────────────────────

describe('registerProviders', () => {
  it('populates ctx.registries.providers from the providers list', () => {
    const ctx = makePluginContext();
    const claude = makeProvider('claude-code');
    const opencode = makeProvider('opencode');

    registerProviders(ctx, [claude, opencode]);

    expect(ctx.registries.providers.size).toBe(2);
    expect(ctx.registries.providers.get('claude-code')).toBe(claude);
    expect(ctx.registries.providers.get('opencode')).toBe(opencode);
  });

  it('preserves registration order in the backing Map', () => {
    const ctx = makePluginContext();
    const a = makeProvider('a');
    const b = makeProvider('b');
    const c = makeProvider('c');
    registerProviders(ctx, [a, b, c]);
    expect(Array.from(ctx.registries.providers.keys())).toEqual(['a', 'b', 'c']);
  });

  it('throws on duplicate ids in the input list', () => {
    const ctx = makePluginContext();
    expect(() =>
      registerProviders(ctx, [makeProvider('claude-code'), makeProvider('claude-code')]),
    ).toThrowError(/already registered/);
  });

  it('is a no-op (and does not throw) when no providers are supplied', () => {
    const ctx = makePluginContext();
    expect(() => registerProviders(ctx)).not.toThrow();
    expect(ctx.registries.providers.size).toBe(0);
  });

  it('logs an info line with the registered provider count and ids', () => {
    const ctx = makePluginContext();
    const infoSpy = vi.spyOn(ctx.logger, 'info');
    registerProviders(ctx, [makeProvider('claude-code'), makeProvider('opencode')]);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('provider registry initialised'),
      expect.objectContaining({ count: 2, ids: ['claude-code', 'opencode'] }),
    );
  });
});
