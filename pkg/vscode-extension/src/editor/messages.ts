/**
 * Message protocol between the host extension and the webview.
 *
 * In the in-process-server architecture the webview talks directly to
 * the embedded HTTP backend, so this protocol is small: the host tells
 * the webview where the server lives + which deep-link to open, and the
 * webview tells the host when it's ready to receive that init.
 */

export type HostToWebview =
  | {
      type: 'init';
      /** Base URL of the in-process Invect server, e.g. `http://127.0.0.1:5xxxx/flowlib`. */
      apiUrl: string;
      /**
       * Initial route to push into Invect's MemoryRouter, e.g.
       * `/flowlib/flow/<id>`. When `undefined`, the webview shows an
       * error/empty state instead of falling back to the dashboard —
       * inside the extension a `.flow.ts` editor should never land on
       * the SPA's home page.
       */
      initialPath?: string;
      /** Active VSCode theme — drives the dark/light class toggle. */
      theme: 'dark' | 'light';
      /**
       * Set when the current file content failed to parse. The webview
       * shows a banner with this message; if `initialPath` is also set
       * (we have a previous-good DB version), the canvas still renders
       * underneath. If `initialPath` is missing, the webview shows the
       * error full-screen instead of any Invect routes.
       */
      parseError?: string;
    }
  | { type: 'themeChanged'; theme: 'dark' | 'light' }
  /**
   * Imperative navigation inside the already-mounted MemoryRouter.
   * Sent when the host wants to switch the in-canvas route without
   * remounting (e.g. user clicks a run in the sidebar → switch to
   * `/flowlib/flow/<id>/runs?runId=...`). React Query cache, sidebar
   * state, etc. all survive.
   */
  | { type: 'navigate'; path: string }
  /**
   * A flow_run lifecycle event landed for `flowId`. Webview reacts by
   * invalidating React Query caches so `useFlowRuns` / `useFlowRun` /
   * `useNodeExecutions` re-fetch and the runs list shows the new run.
   * Sent by the host, which subscribes to the in-process
   * ExecutionEventBus per open file.
   */
  | { type: 'flowRunChanged'; flowId: string }
  /**
   * A new flow_version was just pushed for `flowId`. Webview reacts
   * by invalidating the react-flow query cache so the canvas re-fetches
   * the new graph. Sent by the host whenever the file watcher (or
   * text-document handler) successfully syncs file → DB.
   */
  | { type: 'flowDefinitionChanged'; flowId: string };

const HOST_TO_WEBVIEW_TYPES = new Set<HostToWebview['type']>([
  'init',
  'themeChanged',
  'navigate',
  'flowRunChanged',
  'flowDefinitionChanged',
]);

export function isHostToWebview(x: unknown): x is HostToWebview {
  if (!x || typeof x !== 'object') {
    return false;
  }
  const t = (x as { type?: unknown }).type;
  return typeof t === 'string' && HOST_TO_WEBVIEW_TYPES.has(t as HostToWebview['type']);
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string; data?: unknown };

const WEBVIEW_TO_HOST_TYPES = new Set<WebviewToHost['type']>(['ready', 'log']);

export function isWebviewToHost(x: unknown): x is WebviewToHost {
  if (!x || typeof x !== 'object') {
    return false;
  }
  const t = (x as { type?: unknown }).type;
  return typeof t === 'string' && WEBVIEW_TO_HOST_TYPES.has(t as WebviewToHost['type']);
}
