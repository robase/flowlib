/**
 * web.fetch — SSRF hardening: redirect re-validation and IP-literal
 * encodings that a dotted-quad-only check misses. Complements
 * `web-fetch.test.ts` (base guards, HTML→text, size caps).
 *
 * Network is faked via an injected `fetchImpl`; nothing here dials out.
 */
import { describe, it, expect, vi } from 'vitest';
import { assertFetchableUrl, buildWebFetchTool, isBlockedHost } from '../web-fetch';

/** A `fetchImpl` that replays a scripted sequence of responses. */
function scriptedFetch(responses: Response[]): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const res = responses[i];
    i += 1;
    if (!res) {
      throw new Error(`unexpected extra fetch for ${String(input)}`);
    }
    return res;
  }) as typeof fetch;
  return { impl, urls };
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe('isBlockedHost — IP literal encodings', () => {
  it('blocks IPv4-mapped IPv6 forms of the metadata endpoint', () => {
    // `new URL()` rewrites `[::ffff:169.254.169.254]` to this hex form,
    // which is exactly what slipped past the old dotted-quad check.
    for (const h of [
      '::ffff:a9fe:a9fe', // ::ffff:169.254.169.254, normalised
      '::ffff:169.254.169.254',
      '::ffff:7f00:1', // ::ffff:127.0.0.1
      '::ffff:127.0.0.1',
      '::ffff:0a00:1', // ::ffff:10.0.0.1
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('blocks alternate IPv4 encodings when handed a raw host', () => {
    for (const h of [
      '2130706433', // 127.0.0.1 as a 32-bit int
      '0x7f.0.0.1', // hex octet
      '0177.0.0.1', // octal octet
      '127.1', // 2-part inet_aton form
      '0', // 0.0.0.0
      '0xa9fea9fe', // 169.254.169.254 as hex
      '2852039166', // 169.254.169.254 as an int
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('blocks IPv6 unique-local and link-local addresses', () => {
    for (const h of ['fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'febf::1']) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it('does not false-positive on public hostnames starting with fc/fd/fe', () => {
    // The old `host.startsWith('fc')` blocked every one of these.
    for (const h of ['fcbank.com', 'fdic.gov', 'fedex.com', 'fe80.example.com', 'fd-agency.co']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it('still allows public IPs and hosts', () => {
    for (const h of ['8.8.8.8', '1.1.1.1', '172.32.0.1', 'example.com', '2001:4860:4860::8888']) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it('rejects an IPv4-mapped metadata URL end-to-end', () => {
    expect(() => assertFetchableUrl('http://[::ffff:169.254.169.254]/latest/meta-data')).toThrow(
      /private\/internal/,
    );
  });
});

describe('web.fetch — redirect re-validation', () => {
  it('refuses a redirect that lands on the metadata endpoint', async () => {
    const { impl, urls } = scriptedFetch([
      redirect('http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
      new Response('SECRET_CREDENTIALS'),
    ]);
    const tool = buildWebFetchTool({ fetchImpl: impl });

    await expect(tool.execute({ url: 'https://evil.example.com/redir' }, {})).rejects.toThrow(
      /private\/internal/,
    );
    // Only the first (public) hop was dialed — the metadata host never was.
    expect(urls).toEqual(['https://evil.example.com/redir']);
  });

  it('refuses a redirect to an IPv4-mapped IPv6 metadata address', async () => {
    const { impl, urls } = scriptedFetch([
      redirect('http://[::ffff:169.254.169.254]/latest/meta-data/'),
      new Response('SECRET'),
    ]);
    const tool = buildWebFetchTool({ fetchImpl: impl });

    await expect(tool.execute({ url: 'https://evil.example.com/r' }, {})).rejects.toThrow(
      /private\/internal/,
    );
    expect(urls).toHaveLength(1);
  });

  it('refuses a redirect that switches to a non-http scheme', async () => {
    const { impl } = scriptedFetch([redirect('file:///etc/passwd'), new Response('root:x:0:0')]);
    const tool = buildWebFetchTool({ fetchImpl: impl });

    await expect(tool.execute({ url: 'https://evil.example.com/r' }, {})).rejects.toThrow(
      /only http/,
    );
  });

  it('follows a redirect chain to a public host and reports the final URL', async () => {
    const { impl, urls } = scriptedFetch([
      redirect('https://b.example.com/2'),
      redirect('/3'), // relative Location resolves against the current hop
      new Response('<p>done</p>', { headers: { 'content-type': 'text/html' } }),
    ]);
    const tool = buildWebFetchTool({ fetchImpl: impl });

    const res = (await tool.execute({ url: 'https://a.example.com/1' }, {})) as {
      url: string;
      text: string;
    };
    expect(urls).toEqual([
      'https://a.example.com/1',
      'https://b.example.com/2',
      'https://b.example.com/3',
    ]);
    expect(res.url).toBe('https://b.example.com/3');
    expect(res.text).toContain('done');
  });

  it('bounds the redirect chain', async () => {
    // Always redirects — a `redirect: 'follow'` impl would loop internally.
    const impl = (async (input: RequestInfo | URL) => {
      const n = Number(new URL(String(input)).pathname.slice(1));
      return redirect(`https://example.com/${n + 1}`);
    }) as typeof fetch;
    const tool = buildWebFetchTool({ fetchImpl: impl, maxRedirects: 3 });

    await expect(tool.execute({ url: 'https://example.com/0' }, {})).rejects.toThrow(
      /too many redirects/,
    );
  });

  it('never asks the underlying fetch to follow redirects itself', async () => {
    const spy = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    const tool = buildWebFetchTool({ fetchImpl: spy as unknown as typeof fetch });

    await tool.execute({ url: 'https://example.com/' }, {});

    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });

  it('returns a redirect response as-is when it carries no Location', async () => {
    const { impl } = scriptedFetch([new Response('body', { status: 302 })]);
    const tool = buildWebFetchTool({ fetchImpl: impl });

    const res = (await tool.execute({ url: 'https://example.com/' }, {})) as { status: number };
    expect(res.status).toBe(302);
  });
});
