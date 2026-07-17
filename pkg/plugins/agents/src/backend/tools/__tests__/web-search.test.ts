/**
 * Tests for `web.search` — query construction, Brave/generic result
 * parsing, untrusted-text sanitisation, caps, and error handling. Uses an
 * injected `fetchImpl` so no network is touched.
 */
import { describe, it, expect } from 'vitest';
import { buildWebSearchTool, parseSearchResults } from '../web-search';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BRAVE_BODY = {
  web: {
    results: [
      { title: 'Zod docs', url: 'https://zod.dev', description: 'TypeScript-first schema' },
      { title: 'GitHub', url: 'https://github.com/colinhacks/zod', snippet: 'repo' },
    ],
  },
};

describe('parseSearchResults', () => {
  it('reads Brave web.results and a generic results array', () => {
    expect(parseSearchResults(BRAVE_BODY, 5)).toHaveLength(2);
    expect(parseSearchResults({ results: [{ url: 'https://x.io', title: 'X' }] }, 5)).toEqual([
      { title: 'X', url: 'https://x.io', description: '' },
    ]);
  });

  it('caps results and skips entries without a url', () => {
    const body = {
      web: { results: [{ url: 'https://a' }, { title: 'no-url' }, { url: 'https://b' }] },
    };
    const out = parseSearchResults(body, 1);
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe('https://a');
  });
});

describe('buildWebSearchTool', () => {
  it('sends the key header + query and returns parsed results', async () => {
    let seenUrl = '';
    let seenHeader = '';
    const tool = buildWebSearchTool({
      apiKey: 'secret-key',
      fetchImpl: fakeFetch((url, init) => {
        seenUrl = url;
        seenHeader = String(
          (init?.headers as Record<string, string>)['X-Subscription-Token'] ?? '',
        );
        return json(BRAVE_BODY);
      }),
    });
    const res = (await tool.execute({ query: 'zod schema', count: 2 }, {})) as {
      results: unknown[];
      count: number;
    };
    expect(seenUrl).toContain('q=zod+schema');
    expect(seenUrl).toContain('count=2');
    expect(seenHeader).toBe('secret-key');
    expect(res.count).toBe(2);
    expect(res.results).toHaveLength(2);
  });

  it('sanitises hidden-instruction characters from titles/snippets', async () => {
    const tool = buildWebSearchTool({
      apiKey: 'k',
      fetchImpl: fakeFetch(() =>
        json({ web: { results: [{ url: 'https://x', title: 'hi​there', description: 'a​b' }] } }),
      ),
    });
    const res = (await tool.execute({ query: 'q' }, {})) as {
      results: Array<{ title: string; description: string }>;
    };
    expect(res.results[0]?.title).toBe('hithere');
    expect(res.results[0]?.description).toBe('ab');
  });

  it('rejects an empty query', async () => {
    const tool = buildWebSearchTool({ apiKey: 'k', fetchImpl: fakeFetch(() => json({})) });
    const res = (await tool.execute({ query: '  ' }, {})) as { error?: string };
    expect(res.error).toMatch(/non-empty/);
  });

  it('returns an error result on a non-OK HTTP status', async () => {
    const tool = buildWebSearchTool({
      apiKey: 'k',
      fetchImpl: fakeFetch(() => json({ message: 'rate limited' }, 429)),
    });
    const res = (await tool.execute({ query: 'q' }, {})) as { error?: string };
    expect(res.error).toMatch(/HTTP 429/);
  });
});
