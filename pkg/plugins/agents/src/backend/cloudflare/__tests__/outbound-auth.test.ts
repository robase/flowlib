/**
 * Tests for outbound-Workers auth helpers.
 *
 * The handlers are pure functions of `(request, env) => Response`.
 * Mocks are trivial — an in-memory `OutboundCredentialKVStore` and a
 * patched global `fetch` that captures the forwarded request without
 * making a network call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOWLIB_SESSION_HEADER,
  OutboundCredentialKV,
  buildFlowlibOutboundHandlers,
  createAnthropicOutboundHandler,
  createCloudflareAiGatewayOutboundHandler,
  createGoogleOutboundHandler,
  createOpenAIOutboundHandler,
  createOpenRouterOutboundHandler,
  credentialKvKey,
  type OutboundCredentialKVStore,
} from '../outbound-auth';

function makeKv(initial: Record<string, string> = {}): OutboundCredentialKVStore & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

let originalFetch: typeof fetch;
let lastForwardedRequest: Request | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  lastForwardedRequest = undefined;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    lastForwardedRequest = req;
    return new Response('upstream-ok', { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('credentialKvKey', () => {
  it('packs sessionId and vendor into a stable key', () => {
    expect(credentialKvKey('sess-1', 'anthropic')).toBe('agents/cred/session/sess-1/anthropic');
    expect(credentialKvKey('sess-1', 'openai')).toBe('agents/cred/session/sess-1/openai');
  });
});

describe('OutboundCredentialKV', () => {
  it('round-trips a binding through bind / lookup / unbind', async () => {
    const kv = makeKv();
    const wrapper = new OutboundCredentialKV(kv);
    await wrapper.bind('sess-1', 'anthropic', 'sk-test');
    expect(await wrapper.lookup('sess-1', 'anthropic')).toBe('sk-test');
    await wrapper.unbind('sess-1', 'anthropic');
    expect(await wrapper.lookup('sess-1', 'anthropic')).toBeNull();
  });

  it('refuses empty apiKey', async () => {
    const kv = makeKv();
    const wrapper = new OutboundCredentialKV(kv);
    await expect(wrapper.bind('sess-1', 'anthropic', '')).rejects.toThrow(/empty apiKey/);
  });

  it('writes with the configured TTL', async () => {
    const kv = makeKv();
    const wrapper = new OutboundCredentialKV(kv, 60);
    await wrapper.bind('sess-1', 'openai', 'sk-1');
    expect(kv.put).toHaveBeenCalledWith(
      credentialKvKey('sess-1', 'openai'),
      'sk-1',
      expect.objectContaining({ expirationTtl: 60 }),
    );
  });
});

describe('createAnthropicOutboundHandler', () => {
  it('injects x-api-key + anthropic-version, strips session header, forwards', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'anthropic')]: 'sk-real',
    });
    const handler = createAnthropicOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        [FLOWLIB_SESSION_HEADER]: 'sess-1',
        'x-api-key': 'flowlib-outbound-placeholder',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const res = await handler(req, { KV: kv });
    expect(res.status).toBe(200);
    expect(lastForwardedRequest).toBeDefined();
    expect(lastForwardedRequest!.headers.get('x-api-key')).toBe('sk-real');
    expect(lastForwardedRequest!.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(lastForwardedRequest!.headers.get(FLOWLIB_SESSION_HEADER)).toBeNull();
  });

  it('preserves a caller-supplied anthropic-version header', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'anthropic')]: 'sk-real',
    });
    const handler = createAnthropicOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        [FLOWLIB_SESSION_HEADER]: 'sess-1',
        'anthropic-version': '2024-10-01',
      },
    });
    await handler(req, { KV: kv });
    expect(lastForwardedRequest!.headers.get('anthropic-version')).toBe('2024-10-01');
  });

  it('returns 401 when the session header is missing', async () => {
    const kv = makeKv();
    const handler = createAnthropicOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.anthropic.com/v1/messages');
    const res = await handler(req, { KV: kv });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(new RegExp(FLOWLIB_SESSION_HEADER, 'i'));
    expect(lastForwardedRequest).toBeUndefined();
  });

  it('returns 401 when no credential is bound for the session', async () => {
    const kv = makeKv();
    const handler = createAnthropicOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.anthropic.com/v1/messages', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-no-key' },
    });
    const res = await handler(req, { KV: kv });
    expect(res.status).toBe(401);
    expect(lastForwardedRequest).toBeUndefined();
  });

  it('returns 500 when the KV binding is missing on env', async () => {
    const handler = createAnthropicOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.anthropic.com/v1/messages', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-1' },
    });
    const res = await handler(req, {});
    expect(res.status).toBe(500);
  });
});

describe('createOpenAIOutboundHandler', () => {
  it('injects bearer token', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'openai')]: 'sk-openai',
    });
    const handler = createOpenAIOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://api.openai.com/v1/chat/completions', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-1' },
    });
    await handler(req, { KV: kv });
    expect(lastForwardedRequest!.headers.get('Authorization')).toBe('Bearer sk-openai');
  });
});

describe('createOpenRouterOutboundHandler', () => {
  it('injects bearer token', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'openrouter')]: 'or-key',
    });
    const handler = createOpenRouterOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://openrouter.ai/api/v1/chat/completions', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-1' },
    });
    await handler(req, { KV: kv });
    expect(lastForwardedRequest!.headers.get('Authorization')).toBe('Bearer or-key');
  });
});

describe('createGoogleOutboundHandler', () => {
  it('injects x-goog-api-key', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'google')]: 'goog-key',
    });
    const handler = createGoogleOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://generativelanguage.googleapis.com/v1/models', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-1' },
    });
    await handler(req, { KV: kv });
    expect(lastForwardedRequest!.headers.get('x-goog-api-key')).toBe('goog-key');
  });
});

describe('createCloudflareAiGatewayOutboundHandler', () => {
  it('injects bearer token', async () => {
    const kv = makeKv({
      [credentialKvKey('sess-1', 'cloudflare-ai-gateway')]: 'cf-token',
    });
    const handler = createCloudflareAiGatewayOutboundHandler({ kvBinding: 'KV' });
    const req = new Request('https://gateway.ai.cloudflare.com/...', {
      headers: { [FLOWLIB_SESSION_HEADER]: 'sess-1' },
    });
    await handler(req, { KV: kv });
    expect(lastForwardedRequest!.headers.get('Authorization')).toBe('Bearer cf-token');
  });
});

describe('buildFlowlibOutboundHandlers', () => {
  it('returns a host map covering every supported vendor', () => {
    const map = buildFlowlibOutboundHandlers({ kvBinding: 'KV' });
    expect(Object.keys(map).sort()).toEqual(
      [
        'api.anthropic.com',
        'api.openai.com',
        'gateway.ai.cloudflare.com',
        'generativelanguage.googleapis.com',
        'openrouter.ai',
      ].sort(),
    );
    for (const handler of Object.values(map)) {
      expect(typeof handler).toBe('function');
    }
  });
});
