import * as vscode from 'vscode';

/**
 * Typed wrapper around `vscode.workspace.getConfiguration('flowlib')`.
 *
 * Other lanes (L5/L7/L8/L10/L11/L12) should consume `readConfig()` and
 * `onConfigChange()` rather than calling `getConfiguration().get<string>(...)`
 * with stringly-typed keys. That keeps schema drift at a single chokepoint:
 * if a setting is renamed or its default changes, this module updates and
 * every callsite stays correct.
 *
 * `scope` is a resource URI (typically the document being edited). Most
 * `flowlib.*` settings are declared `"scope": "resource"` so per-folder /
 * per-workspace overrides actually apply.
 */
export interface FlowlibConfig {
  /**
   * Backend URL (e.g. `http://localhost:3000/flowlib`). Empty string means
   * "work offline" — L10 surfaces this as the disconnected state in the
   * status bar. Always trimmed.
   */
  readonly backendUrl: string;

  /**
   * Debounce window (ms) before propagating webview edits back to the
   * underlying `.flow.ts` document. Bounded `[0, 5000]` by the manifest
   * but we don't re-clamp here — settings.json edits the user makes are
   * trusted to be inside the schema range.
   */
  readonly autoSaveDebounceMs: number;

  /**
   * Toggle for L8's diagnostic provider. When false, no squiggles render
   * even if parse/validation fails — the status bar still surfaces problems.
   */
  readonly diagnosticsEnabled: boolean;

  /**
   * If true, format the emitted `.flow.ts` source on save (consistent
   * indentation, sorted footer keys, etc.). Default off — many users have
   * Prettier configured at the repo level and we don't want to fight it.
   */
  readonly formatOnSave: boolean;
}

const DEFAULTS = {
  backendUrl: '',
  autoSaveDebounceMs: 400,
  diagnosticsEnabled: true,
  formatOnSave: false,
} as const;

/**
 * Read the current snapshot. Resolve once at the top of an operation and
 * pass the value through, rather than re-reading inside hot paths — VSCode
 * caches settings cheaply but consistency-within-an-operation matters more.
 */
export function readConfig(scope?: vscode.Uri): FlowlibConfig {
  const c = vscode.workspace.getConfiguration('flowlib', scope);
  const rawUrl = c.get<string>('backendUrl', DEFAULTS.backendUrl);
  return {
    backendUrl: typeof rawUrl === 'string' ? rawUrl.trim() : DEFAULTS.backendUrl,
    autoSaveDebounceMs: c.get<number>('autoSaveDebounceMs', DEFAULTS.autoSaveDebounceMs),
    diagnosticsEnabled: c.get<boolean>('diagnostics.enabled', DEFAULTS.diagnosticsEnabled),
    formatOnSave: c.get<boolean>('formatOnSave', DEFAULTS.formatOnSave),
  };
}

/**
 * Subscribe to `flowlib.*` configuration changes. Filters by section so
 * callbacks don't fire on unrelated edits like a font-family change.
 *
 * Returns a `Disposable` that callers must add to their `ctx.subscriptions`
 * (or a `DisposableStore`) — leaking these means the listener stays alive
 * forever, including across deactivations during dev iteration.
 */
export function onConfigChange(
  cb: (config: FlowlibConfig) => void,
  scope?: vscode.Uri,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('flowlib', scope)) {
      return;
    }
    cb(readConfig(scope));
  });
}

/**
 * Validate a backend URL string before we hand it to a fetch / SSE layer.
 *
 * Rejects:
 *   - empty / whitespace-only
 *   - URLs that don't parse
 *   - non-http(s) schemes (`file://`, `data:`, `javascript:`, `vscode:` …) —
 *     all of which would either bypass the network or trigger surprising
 *     behavior inside Electron.
 *
 * Accepts http and https only. Hostnames aren't validated beyond what
 * `URL` does — `http://localhost`, `http://192.168.1.5:3000`, `http://flowlib.dev`
 * are all fine.
 */
export function isValidBackendUrl(url: string): { ok: true } | { ok: false; reason: string } {
  if (!url) {
    return { ok: false, reason: 'empty' };
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'malformed URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol: ${parsed.protocol}` };
  }

  return { ok: true };
}
