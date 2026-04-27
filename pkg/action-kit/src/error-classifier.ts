/**
 * Error classifier — maps raw SDK / network / internal errors to a typed
 * `NodeErrorDetails` discriminant used by:
 *   - retry policy (what is safe to retry)
 *   - UI surfacing (error badge)
 *   - observability (structured logging)
 *
 * This file is runtime-safe: no SDK imports, no Node-only APIs. Error classes
 * from `openai` / `@anthropic-ai/sdk` are recognized via `constructor.name`
 * duck-typing so `@flowlib/action-kit` stays a types-only package.
 */

import type { NodeErrorCode, NodeErrorDetails } from './node-execution';

/** The default set of error codes considered safe to retry automatically. */
export const DEFAULT_RETRYABLE_ERROR_CODES: readonly NodeErrorCode[] = [
  'RATE_LIMIT',
  'NETWORK',
  'UPSTREAM_5XX',
  'TIMEOUT',
] as const;

interface ClassifyContext {
  /** True if our own per-node timer fired (distinct from SDK connection timeout). */
  timedOut?: boolean;
  /** True if caller's AbortSignal was fired (run cancellation). */
  cancelled?: boolean;
}

/** Substring matches for transient network failures (undici socket teardowns). */
const TRANSIENT_NETWORK_SUBSTRINGS = [
  'terminated',
  'econnreset',
  'etimedout',
  'econnrefused',
  'und_err_socket',
  'und_err_connect_timeout',
  'socket hang up',
  'premature close',
  'network error',
  'fetch failed',
];

function isTransientNetworkMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return TRANSIENT_NETWORK_SUBSTRINGS.some((s) => msg.includes(s));
}

function hasTransientCauseCode(err: Error): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  if (!cause?.code) {
    return false;
  }
  const code = cause.code.toLowerCase();
  return code.includes('econnreset') || code.includes('etimedout') || code.includes('und_err_');
}

type HeadersLike = Headers | Record<string, string | string[]> | undefined;

function readHeader(headers: HeadersLike, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[]>;
  const v = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(v)) {
    return v[0];
  }
  return v;
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Accepts integer seconds or HTTP-date. Returns undefined when absent/invalid.
 */
export function parseRetryAfter(headers: HeadersLike): number | undefined {
  const raw = readHeader(headers, 'retry-after');
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    const delta = parsed - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Classify an error into a `NodeErrorDetails`. Pass `ctx.timedOut` or
 * `ctx.cancelled` when the caller knows the error was triggered by their own
 * abort timer or cancel signal — that signal takes precedence over whatever
 * SDK-level error shape the abort surfaced.
 */
export function classifyError(err: unknown, ctx?: ClassifyContext): NodeErrorDetails {
  if (ctx?.timedOut) {
    return {
      code: 'TIMEOUT',
      message: err instanceof Error ? err.message : 'Execution exceeded timeoutMs',
      retryable: true,
    };
  }
  if (ctx?.cancelled) {
    return {
      code: 'CANCELLED',
      message: err instanceof Error ? err.message : 'Execution was cancelled',
      retryable: false,
    };
  }

  if (!(err instanceof Error)) {
    return {
      code: 'UNKNOWN',
      message: typeof err === 'string' ? err : 'Unknown error',
      retryable: false,
    };
  }

  const status = (err as { status?: unknown }).status;
  const type = (err as { type?: unknown }).type;
  const headers = (err as { headers?: HeadersLike }).headers;
  const providerRequestId = (err as { requestID?: string }).requestID;
  const retryAfterMs = parseRetryAfter(headers);
  const name = err.constructor.name;

  // Schema-parse — our own synthetic marker (see openai/anthropic adapter).
  if ((err as { schemaParse?: boolean }).schemaParse === true) {
    return {
      code: 'SCHEMA_PARSE',
      message: err.message,
      retryable: false,
      cause: truncateCause(err.stack),
    };
  }

  // SDK class-name checks (works for both @anthropic-ai/sdk and openai).
  if (name === 'APIUserAbortError') {
    return { code: 'CANCELLED', message: err.message, retryable: false };
  }
  if (name === 'APIConnectionTimeoutError') {
    return { code: 'TIMEOUT', message: err.message, retryable: true };
  }
  if (name === 'APIConnectionError') {
    return { code: 'NETWORK', message: err.message, retryable: true };
  }
  if (name === 'LengthFinishReasonError') {
    return { code: 'LENGTH_LIMIT', message: err.message, retryable: false };
  }
  if (name === 'ContentFilterFinishReasonError') {
    return { code: 'CONTENT_FILTER', message: err.message, retryable: false };
  }

  // AbortError from fetch/setTimeout — treat as cancelled unless ctx says otherwise.
  if (err.name === 'AbortError') {
    return { code: 'CANCELLED', message: err.message, retryable: false };
  }

  const providerErrorType = typeof type === 'string' ? type : undefined;

  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return {
        code: 'AUTH',
        providerStatusCode: status,
        providerErrorType,
        providerRequestId,
        message: err.message,
        retryable: false,
      };
    }
    if (status === 429) {
      return {
        code: 'RATE_LIMIT',
        providerStatusCode: status,
        providerErrorType,
        providerRequestId,
        message: err.message,
        retryable: true,
        retryAfterMs,
      };
    }
    if (status === 400) {
      // OpenAI signals billing problems as 400 insufficient_quota.
      if (providerErrorType && providerErrorType.includes('quota')) {
        return {
          code: 'QUOTA',
          providerStatusCode: status,
          providerErrorType,
          providerRequestId,
          message: err.message,
          retryable: false,
        };
      }
      if (providerErrorType && providerErrorType.includes('content')) {
        return {
          code: 'CONTENT_FILTER',
          providerStatusCode: status,
          providerErrorType,
          providerRequestId,
          message: err.message,
          retryable: false,
        };
      }
      return {
        code: 'BAD_REQUEST',
        providerStatusCode: status,
        providerErrorType,
        providerRequestId,
        message: err.message,
        retryable: false,
      };
    }
    if (status === 404) {
      return {
        code: 'NOT_FOUND',
        providerStatusCode: status,
        providerErrorType,
        providerRequestId,
        message: err.message,
        retryable: false,
      };
    }
    if (status >= 500 && status < 600) {
      return {
        code: 'UPSTREAM_5XX',
        providerStatusCode: status,
        providerErrorType,
        providerRequestId,
        message: err.message,
        retryable: true,
      };
    }
  }

  if (isTransientNetworkMessage(err.message) || hasTransientCauseCode(err)) {
    return { code: 'NETWORK', message: err.message, retryable: true };
  }

  if (providerErrorType && providerErrorType.includes('quota')) {
    return {
      code: 'QUOTA',
      providerErrorType,
      providerRequestId,
      message: err.message,
      retryable: false,
    };
  }

  return {
    code: 'UNKNOWN',
    message: err.message,
    retryable: false,
    providerRequestId,
    cause: truncateCause(err.stack),
  };
}

function truncateCause(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  return stack.length > 2048 ? stack.slice(0, 2048) : stack;
}
