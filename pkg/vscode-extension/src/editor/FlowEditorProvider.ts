/**
 * Custom editor for `.flow.ts`. Each tab hosts the full `<Invect>` UI
 * pointed at the in-process Express server, deep-linked to the flow row
 * that backs the open file.
 *
 * The webview itself has no special knowledge of the file — it just
 * loads the Invect SPA against the local backend. The host is
 * responsible for:
 *
 *   1. Booting the embedded server (lazy, via `InProcessBackend`).
 *   2. Ensuring a DB flow row exists for the file URI (creates the row
 *      tagged with `__file__:<uri>` if missing) and pushes the current
 *      file content as a new version so the canvas opens with the
 *      latest definition.
 *   3. Sending the webview an `init` payload with the server URL and
 *      the deep-link path `/flowlib/flow/<dbId>`.
 *
 * Theme + workspace-trust transitions are still forwarded.
 */

import * as vscode from 'vscode';

import { DisposableStore } from '../util/disposables';
import { getExtensionLogger } from '../util/logger';
import { buildWebviewHtml } from './webview-host';
import { parseFlowFile } from '../flow-file/parse';
import { isWebviewToHost, type HostToWebview } from './messages';
import type { Backend } from '../backend/Backend';

function resolveTheme(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme?.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

export interface FlowEditorProviderDeps {
  /**
   * Returns the backend the provider should target. Always the embedded
   * one for now — we only deep-link into the in-process server, since
   * remote backends won't have a row for our local file URI.
   */
  getBackend: () => Backend;
  /** Resolves the in-process server's base URL. */
  getApiUrl: () => Promise<string>;
  /**
   * Resolve a file URI to the DB flow id that backs it, creating the
   * row + pushing a fresh version as a side effect. Implemented by the
   * embedded backend.
   */
  ensureFlowForFile: (fileUri: vscode.Uri) => Promise<string>;
  /**
   * Look up the DB flow id for `fileUri` WITHOUT creating one or
   * touching the file. Used on parse failure to fall back to the
   * previous good version instead of the SPA dashboard.
   */
  findFlowIdForFile: (fileUri: string) => Promise<string | undefined>;
  /**
   * Subscribe to flow_run lifecycle events on the in-process bus for a
   * file. Used to push live runs-list updates into the webview without
   * polling. Returns an unsubscriber.
   */
  subscribeFlowRuns: (fileUri: string, callback: () => void) => Promise<() => void>;
}

export class FlowEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'flowlib.flowEditor';
  /** Active panels keyed by `document.uri.toString()`. */
  private static readonly panels = new Map<string, vscode.WebviewPanel>();

  static getPanel(uri: vscode.Uri): vscode.WebviewPanel | undefined {
    return this.panels.get(uri.toString());
  }

  static postTo(uri: vscode.Uri, msg: HostToWebview): boolean {
    const panel = this.panels.get(uri.toString());
    if (!panel) {
      return false;
    }
    void panel.webview.postMessage(msg);
    return true;
  }

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly deps: FlowEditorProviderDeps,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const logger = getExtensionLogger();
    const store = new DisposableStore();
    const docKey = document.uri.toString();
    FlowEditorProvider.panels.set(docKey, webviewPanel);

    let webviewReady = false;
    let initRetryTimer: NodeJS.Timeout | undefined;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')],
    };

    const post = (msg: HostToWebview): void => {
      void webviewPanel.webview.postMessage(msg);
    };

    /**
     * Build + send the init payload. Best-effort: if anything fails
     * (parse error, server boot crash) we still send a minimal init so
     * the webview can render an error state.
     */
    let busUnsubscribe: (() => void) | undefined;
    const subscribeBusOnce = async (): Promise<void> => {
      if (busUnsubscribe) {
        return;
      }
      busUnsubscribe = await this.deps.subscribeFlowRuns(docKey, () => {
        // Bus emits one event per node-execution / run update. Coalesce
        // would be nice but invalidation is cheap on the webview side.
        // Pass empty flowId — the webview invalidates by query-key
        // prefix, which already covers all per-flow caches.
        post({ type: 'flowRunChanged', flowId: '' });
      });
    };

    const sendInit = async (): Promise<void> => {
      try {
        const apiUrl = await this.deps.getApiUrl();
        const parsed = await parseFlowFile(document.getText(), {
          trusted: vscode.workspace.isTrusted,
        });
        if (!parsed.ok) {
          logger.warn('flow parse failed at init', { uri: docKey, error: parsed.error });
          // Don't fall back to the SPA dashboard. If we already know a
          // DB flow id for this file (file was opened successfully
          // before), deep-link to it — the canvas renders the last
          // good version while the parseError banner explains what's
          // wrong. If we don't, render the parse error full-screen.
          const existingId = await this.deps.findFlowIdForFile(docKey);
          post({
            type: 'init',
            apiUrl,
            initialPath: existingId ? `/flowlib/flow/${encodeURIComponent(existingId)}` : undefined,
            theme: resolveTheme(),
            parseError: parsed.error,
          });
          return;
        }
        const dbFlowId = await this.deps.ensureFlowForFile(document.uri);
        post({
          type: 'init',
          apiUrl,
          initialPath: `/flowlib/flow/${encodeURIComponent(dbFlowId)}`,
          theme: resolveTheme(),
        });
        // The DB row exists now (ensureFlowForFile created it if needed),
        // so subscribing to its bus channel will work.
        await subscribeBusOnce();
        logger.info('flow editor init sent', { uri: docKey, dbFlowId });
      } catch (err) {
        logger.error('sendInit failed', { uri: docKey, error: (err as Error).message });
      }
    };

    // Webview → host messages.
    store.add(
      webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
        if (!isWebviewToHost(raw)) {
          return;
        }
        switch (raw.type) {
          case 'ready':
            webviewReady = true;
            if (initRetryTimer) {
              clearInterval(initRetryTimer);
              initRetryTimer = undefined;
            }
            void sendInit();
            return;
          case 'log': {
            const { level, msg, data } = raw;
            const log2 = getExtensionLogger();
            if (level === 'error') {
              log2.error(`[webview] ${msg}`, data);
            } else if (level === 'warn') {
              log2.warn(`[webview] ${msg}`, data);
            } else {
              log2.info(`[webview] ${msg}`, data);
            }
            return;
          }
        }
      }),
    );

    // Theme changes
    store.add(
      vscode.window.onDidChangeActiveColorTheme(() => {
        post({ type: 'themeChanged', theme: resolveTheme() });
      }),
    );

    // Workspace trust grant — re-init so evaluator path becomes available.
    store.add(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        logger.info('workspace trust granted, re-initialising editor', { uri: docKey });
        void sendInit();
      }),
    );

    store.add(
      webviewPanel.onDidDispose(() => {
        if (initRetryTimer) {
          clearInterval(initRetryTimer);
          initRetryTimer = undefined;
        }
        if (busUnsubscribe) {
          busUnsubscribe();
          busUnsubscribe = undefined;
        }
        FlowEditorProvider.panels.delete(docKey);
        logger.debug('webview disposed', { uri: docKey });
        store.dispose();
      }),
    );

    // Set the HTML synchronously — booting the server is async and we
    // don't want to leave the webview without a CSP during that window.
    // The CSP's `connect-src` allows `127.0.0.1:*` so the eventual
    // server URL (whatever port it lands on) is already permitted.
    webviewPanel.webview.html = buildWebviewHtml({
      extensionUri: this.ctx.extensionUri,
      webview: webviewPanel.webview,
    });

    // Safety net: VSCode buffers postMessage until the webview is ready,
    // so we can proactively send `init` even before `ready` arrives.
    initRetryTimer = setInterval(() => {
      if (webviewReady) {
        if (initRetryTimer) {
          clearInterval(initRetryTimer);
          initRetryTimer = undefined;
        }
        return;
      }
      void sendInit();
    }, 1000);

    logger.info('flow editor opened', { uri: docKey });
  }
}
