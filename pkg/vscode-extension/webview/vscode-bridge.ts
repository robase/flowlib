/**
 * Typed wrapper around VSCode's `acquireVsCodeApi()`.
 *
 * Consumes Contract B from `src/editor/messages.ts` (Lane L5) and re-exports
 * `HostToWebview` / `WebviewToHost` so the React app gets the exact same
 * shapes the host produces / consumes. Runtime type guards remain useful even
 * after typing because the `message` event dispatches arbitrary `unknown`
 * payloads (a misbehaving extension or DevTools could post anything).
 */

import { isHostToWebview, type HostToWebview, type WebviewToHost } from '../src/editor/messages';

export type { HostToWebview, WebviewToHost };

interface VsCodeApi<TState = unknown> {
  postMessage(message: WebviewToHost): void;
  setState(state: TState): void;
  getState(): TState | undefined;
}

declare function acquireVsCodeApi<TState = unknown>(): VsCodeApi<TState>;

let cached: VsCodeApi | undefined;

/**
 * Returns the VSCode webview API handle. Safe to call multiple times — the
 * underlying `acquireVsCodeApi()` may only be invoked once per page load,
 * so we cache the handle on first access. Returns `undefined` outside a
 * webview (e.g. local Vite preview) so callers can no-op gracefully.
 */
export function getVsCodeApi(): VsCodeApi | undefined {
  if (cached) {
    return cached;
  }
  if (typeof acquireVsCodeApi === 'undefined') {
    return undefined;
  }
  cached = acquireVsCodeApi();
  return cached;
}

/**
 * Subscribe to messages from the extension host. Filters via the Contract B
 * type guard — non-conforming payloads are ignored silently. Returns a
 * cleanup function callers must invoke (e.g. from a React effect).
 */
export function onHostMessage(handler: (message: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (isHostToWebview(event.data)) {
      handler(event.data);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Send a typed message to the extension host. No-op outside a webview. */
export function postToHost(message: WebviewToHost): void {
  getVsCodeApi()?.postMessage(message);
}

/** Forward a webview-side log line to the host's `Flowlib (Webview)` channel. */
export function logToHost(level: 'info' | 'warn' | 'error', msg: string, data?: unknown): void {
  postToHost({ type: 'log', level, msg, data });
}
