/**
 * Webview app — renders the full `<Invect>` UI from `@flowlib/ui`,
 * pointed at the in-process Express server the host bootstrapped on
 * `127.0.0.1:<port>`.
 *
 * The host posts an `init` message with the server URL and the optional
 * deep-link path (e.g. `/flowlib/flow/<id>` or
 * `/flowlib/flow/<id>/runs?runId=...`). We mount Invect inside our own
 * MemoryRouter so we can control the initial entry; subsequent
 * navigation happens internally via the standard ModeSwitcher / sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { Invect } from '@flowlib/ui';
import { webhooks } from '@flowlib/webhooks';

import { logToHost, onHostMessage, postToHost, type HostToWebview } from './vscode-bridge';

interface AppState {
  apiUrl: string | null;
  /**
   * Where to mount the MemoryRouter. `null` means "no flow context" —
   * we render an empty / error state rather than falling back to
   * `/flowlib` (the SPA dashboard), which the extension never wants
   * to show inside a `.flow.ts` editor tab.
   */
  initialPath: string | null;
  theme: 'dark' | 'light';
  /**
   * One-shot navigation request from the host. Set when a `navigate`
   * message arrives; consumed by `<Navigator>` inside the router.
   */
  pendingNav: { path: string; seq: number } | null;
  /**
   * Set when the host couldn't parse the current file. Renders a
   * banner (when `initialPath` is also set — canvas underneath shows
   * the last good version) or full-screen (when there's no flow id
   * to fall back to).
   */
  parseError: string | null;
}

const INITIAL_STATE: AppState = {
  apiUrl: null,
  initialPath: null,
  theme: detectInitialTheme(),
  pendingNav: null,
  parseError: null,
};

function detectInitialTheme(): 'dark' | 'light' {
  const cls = document.body.className;
  if (cls.includes('vscode-light') || cls.includes('high-contrast-light')) {
    return 'light';
  }
  return 'dark';
}

export function FlowEditorApp(): JSX.Element {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [readyAnnounced, setReadyAnnounced] = useState(false);

  // Stable QueryClient — created once per webview lifetime. Declared
  // up-front so the message handler closure can reference it without
  // hitting the temporal dead zone when invalidating queries.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
      }),
    [],
  );

  useEffect(() => {
    logToHost('info', 'FlowEditorApp mounted');
    const handle = (msg: HostToWebview): void => {
      logToHost('info', 'webview received message', { type: msg.type });
      switch (msg.type) {
        case 'init':
          setState((s) => ({
            ...s,
            apiUrl: msg.apiUrl,
            // Don't override a previously-set `initialPath` — once
            // MemoryRouter is mounted, `initialEntries` changes are
            // ignored anyway, and a re-init message shouldn't trample
            // an in-flight `navigate`. We never fall back to `/flowlib`
            // (dashboard) — null means "show the empty/error state".
            initialPath: s.initialPath ?? msg.initialPath ?? null,
            theme: msg.theme,
            parseError: msg.parseError ?? null,
          }));
          return;
        case 'themeChanged':
          setState((s) => ({ ...s, theme: msg.theme }));
          return;
        case 'navigate':
          setState((s) => ({
            ...s,
            pendingNav: { path: msg.path, seq: (s.pendingNav?.seq ?? 0) + 1 },
          }));
          return;
        case 'flowRunChanged':
          // The host subscribed to the in-process bus and is telling us
          // a run lifecycle event landed for `flowId`. Invalidate the
          // runs-list and per-run query caches so FlowRunsView re-fetches.
          // Query keys per `pkg/ui/src/api/query-keys.ts`:
          //   executions(flowId) → ['executions', flowId]    (also covers flowRun(id))
          //   nodeExecutions(runId) → ['node-executions', runId]
          queryClient.invalidateQueries({ queryKey: ['executions'] });
          queryClient.invalidateQueries({ queryKey: ['node-executions'] });
          return;
        case 'flowDefinitionChanged':
          // A new flow_version was pushed (text-editor save, file
          // watcher pickup, etc.). Invalidate the canvas's react-flow
          // query so it re-fetches the new graph. Key shape:
          //   reactFlow(flowId, version, flowRunId) → ['flows', flowId, 'react-flow', ...]
          queryClient.invalidateQueries({ queryKey: ['flows'] });
          return;
      }
    };
    const unsubscribe = onHostMessage(handle);
    if (!readyAnnounced) {
      setReadyAnnounced(true);
      postToHost({ type: 'ready' });
    }
    return unsubscribe;
  }, [readyAnnounced]);

  // Apply theme to body so Invect's ThemeProvider picks the right tokens.
  useEffect(() => {
    document.body.classList.toggle('vscode-dark', state.theme === 'dark');
    document.body.classList.toggle('vscode-light', state.theme === 'light');
  }, [state.theme]);

  // Frontend plugins to enable inside the embedded Invect UI. The
  // webhooks plugin contributes the /webhooks route + sidebar entry —
  // the backend half lives in the in-process express server.
  const plugins = useMemo(() => [webhooks()], []);
  const config = useMemo(
    () => ({
      apiPath: state.apiUrl ?? '',
      frontendPath: '/flowlib',
      theme: state.theme,
      plugins,
    }),
    [state.apiUrl, state.theme, plugins],
  );

  // Must be declared BEFORE the early return below — rules of hooks.
  const clearPendingNav = useCallback(() => {
    setState((s) => ({ ...s, pendingNav: null }));
  }, []);

  if (!state.apiUrl) {
    return (
      <div className="flowlib-fallback">
        <h2>Connecting…</h2>
        <p style={{ fontSize: 11, opacity: 0.6 }}>
          Waiting for the host to start the embedded backend.
        </p>
      </div>
    );
  }

  // No deep-link path AND no fallback DB row — render the parse error
  // (or a generic empty state) full-screen instead of falling back to
  // the SPA dashboard. The extension's `.flow.ts` editor should never
  // land on `/flowlib`.
  if (!state.initialPath) {
    return (
      <div className="flowlib-fallback">
        <h2>Can't open this flow</h2>
        <p>{state.parseError ?? 'No flow context. Open a .flow.ts file from the sidebar.'}</p>
      </div>
    );
  }

  return (
    <MemoryRouter initialEntries={[state.initialPath]}>
      <Navigator pendingNav={state.pendingNav} onApplied={clearPendingNav} />
      {state.parseError && <ParseErrorBanner error={state.parseError} />}
      <Invect config={config} reactQueryClient={queryClient} />
    </MemoryRouter>
  );
}

/**
 * Slim banner overlay shown above the canvas when the file's current
 * source has parse errors but a previous good DB version is rendering
 * underneath. Doesn't take up much vertical space — the canvas is the
 * primary thing the user is looking at.
 */
function ParseErrorBanner({ error }: { error: string }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: '6px 12px',
        background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
        color: 'var(--vscode-inputValidation-errorForeground, #fff)',
        borderBottom: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
        fontSize: 12,
        fontFamily: 'var(--vscode-font-family)',
      }}
    >
      <strong>File has parse errors — showing last good version.</strong>{' '}
      <span style={{ opacity: 0.85 }}>{error}</span>
    </div>
  );
}

/**
 * Renders nothing; subscribes to `pendingNav` and calls `useNavigate()`
 * each time a new navigation request arrives. Lives inside MemoryRouter
 * so the navigate hook resolves to the right router instance.
 */
function Navigator({
  pendingNav,
  onApplied,
}: {
  pendingNav: AppState['pendingNav'];
  onApplied: () => void;
}): null {
  const navigate = useNavigate();
  useEffect(() => {
    if (!pendingNav) {
      return;
    }
    navigate(pendingNav.path);
    onApplied();
  }, [pendingNav, navigate, onApplied]);
  return null;
}
