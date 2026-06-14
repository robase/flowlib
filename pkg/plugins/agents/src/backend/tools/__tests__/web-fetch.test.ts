/**
 * web.fetch — SSRF guards, scheme validation, HTML→text, size caps.
 * Network is faked via an injected `fetchImpl`.
 */
import { describe, it, expect } from 'vitest';
import { assertFetchableUrl, buildWebFetchTool, htmlToText, isBlockedHost } from '../web-fetch';

describe('web.fetch — SSRF / scheme guards', () => {
  it('blocks loopback, private, link-local, and metadata hosts', () => {
    for (const h of [
      'localhost',
      'foo.localhost',
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '192.168.0.5',
      '172.16.9.9',
      '169.254.169.254', // cloud metadata
      '::1',
      'svc.internal',
      '100.64.1.1', // CGNAT
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', 'api.github.com', '172.32.0.1']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it('rejects non-http(s) schemes and private targets', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(/only http/);
    expect(() => assertFetchableUrl('ftp://example.com')).toThrow(/only http/);
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      /private\/internal/,
    );
    expect(() => assertFetchableUrl('not a url')).toThrow(/invalid URL/);
    expect(assertFetchableUrl('https://example.com/x').toString()).toBe('https://example.com/x');
  });
});

describe('htmlToText', () => {
  it('strips scripts/styles/tags and decodes basic entities', () => {
    const html =
      '<html><head><style>.x{}</style><script>evil()</script></head>' +
      '<body><h1>Title</h1><p>Hello&nbsp;&amp; welcome</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Hello & welcome');
    expect(text).not.toContain('evil()');
    expect(text).not.toContain('<');
  });
});

describe('web.fetch tool execute', () => {
  function fakeFetch(body: string, contentType: string): typeof fetch {
    return (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': contentType },
      })) as typeof fetch;
  }

  it('fetches HTML and returns stripped text', async () => {
    const tool = buildWebFetchTool({
      fetchImpl: fakeFetch('<p>Docs <b>here</b></p>', 'text/html; charset=utf-8'),
    });
    const res = (await tool.execute({ url: 'https://example.com' }, {})) as {
      status: number;
      text: string;
      truncated: boolean;
    };
    expect(res.status).toBe(200);
    expect(res.text).toContain('Docs here');
    expect(res.text).not.toContain('<p>');
  });

  it('returns non-HTML bodies as-is', async () => {
    const tool = buildWebFetchTool({
      fetchImpl: fakeFetch('{"a":1}', 'application/json'),
    });
    const res = (await tool.execute({ url: 'https://api.example.com/x' }, {})) as { text: string };
    expect(res.text).toBe('{"a":1}');
  });

  it('caps extracted text at maxChars and flags truncated', async () => {
    const big = 'x'.repeat(10_000);
    const tool = buildWebFetchTool({ fetchImpl: fakeFetch(big, 'text/plain'), maxChars: 100 });
    const res = (await tool.execute({ url: 'https://example.com' }, {})) as {
      text: string;
      truncated: boolean;
    };
    expect(res.text.length).toBe(100);
    expect(res.truncated).toBe(true);
  });

  it('refuses to fetch a private address (SSRF)', async () => {
    let called = false;
    const tool = buildWebFetchTool({
      fetchImpl: (async () => {
        called = true;
        return new Response('secret');
      }) as typeof fetch,
    });
    await expect(tool.execute({ url: 'http://169.254.169.254/' }, {})).rejects.toThrow(
      /private\/internal/,
    );
    expect(called).toBe(false); // never even dialed
  });
});
