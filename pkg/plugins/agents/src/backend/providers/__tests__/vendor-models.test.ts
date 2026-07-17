/**
 * Unit tests for `fetchVendorModels` — verifies each vendor's response is
 * normalised to the backend model-string format, plus filtering, caching,
 * and the unsupported-vendor path. All network is faked via `fetchImpl`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchVendorModels,
  clearVendorModelCache,
  SUPPORTED_MODEL_VENDORS,
} from '../vendor-models';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake fetch that records calls and returns a canned body. */
function fakeFetch(body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return jsonResponse(body);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => clearVendorModelCache());

describe('fetchVendorModels', () => {
  it('openrouter: passes ids through and uses name as label', async () => {
    const { impl, calls } = fakeFetch({
      data: [
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
      ],
    });
    const models = await fetchVendorModels('openrouter', { apiKey: 'k' }, { fetchImpl: impl });
    expect(calls[0]).toContain('openrouter.ai/api/v1/models');
    expect(models).toEqual([
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
    ]);
  });

  it('anthropic: prefixes anthropic/ and uses display_name', async () => {
    const { impl, calls } = fakeFetch({
      data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }],
    });
    const models = await fetchVendorModels('anthropic', { apiKey: 'k' }, { fetchImpl: impl });
    expect(calls[0]).toContain('api.anthropic.com/v1/models');
    expect(models).toEqual([{ id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }]);
  });

  it('openai: filters to chat families and prefixes openai/', async () => {
    const { impl } = fakeFetch({
      data: [
        { id: 'gpt-4o' },
        { id: 'o3-mini' },
        { id: 'text-embedding-3-small' }, // dropped
        { id: 'whisper-1' }, // dropped
        { id: 'chatgpt-4o-latest' },
      ],
    });
    const models = await fetchVendorModels('openai', { apiKey: 'k' }, { fetchImpl: impl });
    expect((models ?? []).map((m) => m.id)).toEqual([
      'openai/chatgpt-4o-latest',
      'openai/gpt-4o',
      'openai/o3-mini',
    ]);
  });

  it('google: strips models/ prefix, filters generateContent, prefixes google/', async () => {
    const { impl, calls } = fakeFetch({
      models: [
        {
          name: 'models/gemini-2.0-flash',
          displayName: 'Gemini 2.0 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/embedding-001',
          displayName: 'Embedding',
          supportedGenerationMethods: ['embedContent'], // dropped
        },
      ],
    });
    const models = await fetchVendorModels('google', { apiKey: 'k' }, { fetchImpl: impl });
    expect(calls[0]).toContain('generativelanguage.googleapis.com');
    expect(models).toEqual([{ id: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' }]);
  });

  it('returns null for an unsupported vendor', async () => {
    const { impl } = fakeFetch({});
    const models = await fetchVendorModels('cohere', { apiKey: 'k' }, { fetchImpl: impl });
    expect(models).toBeNull();
  });

  it('caches within the TTL and re-fetches after it expires', async () => {
    const { impl, calls } = fakeFetch({ data: [{ id: 'anthropic/x', name: 'X' }] });
    let t = 1_000;
    const now = () => t;
    await fetchVendorModels('openrouter', { apiKey: 'k' }, { fetchImpl: impl, now });
    await fetchVendorModels('openrouter', { apiKey: 'k' }, { fetchImpl: impl, now });
    expect(calls.length).toBe(1); // second call served from cache
    t += 11 * 60_000; // past the 10-min TTL
    await fetchVendorModels('openrouter', { apiKey: 'k' }, { fetchImpl: impl, now });
    expect(calls.length).toBe(2);
  });

  it('throws on an HTTP error so the endpoint can fall back', async () => {
    const impl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(
      fetchVendorModels('openrouter', { apiKey: 'bad' }, { fetchImpl: impl }),
    ).rejects.toThrow(/401/);
  });

  it('exposes the supported vendor set', () => {
    expect(SUPPORTED_MODEL_VENDORS).toContain('openrouter');
    expect(SUPPORTED_MODEL_VENDORS).toContain('anthropic');
    expect(SUPPORTED_MODEL_VENDORS).toContain('openai');
    expect(SUPPORTED_MODEL_VENDORS).toContain('google');
  });
});
