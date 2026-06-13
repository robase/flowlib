/**
 * Express request → Web `Request` bridge.
 *
 * The Express adapter previously inlined this construction in two places
 * (the global `onRequest` middleware and the plugin-endpoint dispatch loop).
 * Centralising here keeps the URL composition, header forwarding, and
 * body serialisation rules in one place.
 *
 * NOTE: Express's `req.body` is already JSON-parsed by `express.json()`
 * middleware. We re-serialise it for non-GET/HEAD/DELETE so the resulting
 * Web `Request` has a consumable stream — plugin auth proxies (e.g.
 * better-auth) call `request.json()` themselves.
 */

import type { FlowlibHttpMethod, FlowlibHttpResult } from '../types';

/**
 * Minimal Express request shape. We don't import `@types/express` here
 * because `@flowlib/http` deliberately stays framework-free — the adapter
 * package supplies an Express request and casts to this interface.
 */
export interface ExpressRequestLike {
  method: string;
  protocol: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  get(name: string): string | undefined;
  /**
   * Optional AbortSignal forwarded to the Web `Request`. When the host wires
   * this to `req.on('close', () => controller.abort())`, streaming handlers
   * can listen on `request.signal` to cancel promptly on client disconnect.
   */
  signal?: AbortSignal;
}

const METHODS_WITH_BODY: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Convert an Express `req` into a Web `Request`. Headers and method are
 * forwarded verbatim; for `POST`/`PUT`/`PATCH` the already-parsed body is
 * re-serialised as JSON so the stream is consumable downstream.
 */
export function toWebRequestFromExpress(req: ExpressRequestLike): Request {
  const url = `${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`;
  const init: RequestInit = {
    method: req.method,
    headers: req.headers as HeadersInit,
  };
  if (METHODS_WITH_BODY.has(req.method.toUpperCase()) && req.body !== undefined) {
    init.body = JSON.stringify(req.body);
  }
  if (req.signal) {
    init.signal = req.signal;
  }
  return new globalThis.Request(url, init);
}

/**
 * Narrow an arbitrary HTTP method string to the methods Flowlib's route
 * surface uses. Falls back to `GET` for unsupported verbs (e.g. HEAD,
 * OPTIONS) — those don't reach Flowlib's handlers anyway.
 */
export function normaliseHttpMethod(method: string): FlowlibHttpMethod {
  const upper = method.toUpperCase();
  if (
    upper === 'GET' ||
    upper === 'POST' ||
    upper === 'PUT' ||
    upper === 'PATCH' ||
    upper === 'DELETE'
  ) {
    return upper;
  }
  return 'GET';
}

/**
 * Minimal Express response shape. Keeps the bridge framework-free.
 *
 * `json` and `write`/`end`/`flushHeaders` are only needed by
 * `writeFlowlibHttpResultToExpress`; `writeWebResponseToExpress` doesn't
 * touch them.
 */
export interface ExpressResponseLike {
  status(code: number): unknown;
  setHeader(name: string, value: string | string[]): unknown;
  send(body: Buffer | string): unknown;
  json?(body: unknown): unknown;
  write?(chunk: Uint8Array | string): unknown;
  end?(): unknown;
  flushHeaders?(): unknown;
  /** Node stream events — used to cancel a stream on client disconnect. */
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

/**
 * Write a Web `Response` to an Express `res`, preserving multiple
 * `Set-Cookie` headers verbatim.
 *
 * The browser-spec `Headers.forEach()` collapses repeated `Set-Cookie`
 * values into a single comma-separated string, which breaks cookie parsing
 * downstream. `Headers.getSetCookie()` (Node 20+) returns the individual
 * values; we forward those as an array to Express, which serialises each
 * into its own `Set-Cookie:` line.
 *
 * Used by the auth-proxy passthrough path (better-auth needs cookies to
 * round-trip the redirect dance).
 */
export async function writeWebResponseToExpress(
  response: Response,
  res: ExpressResponseLike,
): Promise<void> {
  const arrayBuf = await response.arrayBuffer();
  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') {
      res.setHeader(key, value);
    }
  });
  const setCookies = response.headers.getSetCookie?.();
  if (setCookies && setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }
  res.send(Buffer.from(arrayBuf));
}

/**
 * Translate a `FlowlibHttpResult` (the union returned by shared endpoint
 * handlers and the plugin dispatcher) into an Express response.
 *
 *   - `json`     → `res.status(...).json(body)` with optional headers
 *   - `response` → `writeWebResponseToExpress` (preserves Set-Cookie)
 *   - `stream`   → SSE-shaped `text/event-stream` chunked write
 *
 * Used by the shared endpoint mounter and the plugin-endpoint dispatch site.
 */
export async function writeFlowlibHttpResultToExpress(
  result: FlowlibHttpResult,
  res: ExpressResponseLike,
): Promise<void> {
  if (result.kind === 'response') {
    await writeWebResponseToExpress(result.response, res);
    return;
  }
  if (result.kind === 'stream') {
    res.status(result.status);
    // Sensible SSE defaults; endpoint-supplied headers override.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
    }
    res.flushHeaders?.();
    const reader = result.stream.getReader();
    const write = res.write?.bind(res);
    const end = res.end?.bind(res);
    if (!write || !end) {
      throw new Error('Express response missing write/end — cannot stream');
    }
    // Client disconnect → cancel the stream so its `cancel()` can abort
    // the underlying work (e.g. the agent turn + LLM stream + sandbox).
    let cancelled = false;
    const onClose = (): void => {
      cancelled = true;
      void reader.cancel().catch(() => {});
    };
    res.on?.('close', onClose);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          end();
          return;
        }
        if (cancelled) {
          return;
        }
        write(value);
      }
    } finally {
      res.off?.('close', onClose);
    }
  }
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  res.status(result.status);
  // 204 No Content + null/undefined body: send no body. The previous Express
  // adapter used `res.status(204).send()` for trigger DELETE; sending the
  // string `"null"` would change observable behaviour for clients that
  // distinguish empty bodies.
  if (result.body === null || result.body === undefined) {
    res.send('');
    return;
  }
  if (res.json) {
    res.json(result.body);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(result.body));
  }
}
