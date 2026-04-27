/**
 * Opens a non-file-backed Invect webview tab — credentials, webhooks,
 * dashboard, etc. Reuses the same webview HTML / React app as the
 * `.flow.ts` custom editor, just initialised at a different route.
 *
 * Panels are cached per route so re-opening the same view focuses the
 * existing tab instead of stacking new ones.
 */

import * as vscode from 'vscode';
import { buildWebviewHtml } from './webview-host';
import { isWebviewToHost, type HostToWebview } from './messages';
import { getExtensionLogger } from '../util/logger';

function resolveTheme(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme?.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark';
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  initialPath: string;
}

export class InvectPanelProvider implements vscode.Disposable {
  private readonly panels = new Map<string, OpenPanel>();
  private themeListener: vscode.Disposable;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly getApiUrl: () => Promise<string>,
  ) {
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      const msg: HostToWebview = { type: 'themeChanged', theme: resolveTheme() };
      for (const { panel } of this.panels.values()) {
        void panel.webview.postMessage(msg);
      }
    });
  }

  /**
   * Open (or focus) a panel showing the Invect UI deep-linked to
   * `initialPath` (e.g. `/flowlib/credentials`). `key` deduplicates
   * panels — opening the same key twice reveals the existing tab.
   */
  async open(key: string, title: string, initialPath: string): Promise<void> {
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      // Re-init in case the requested path differs from before (e.g.
      // user picked a different run for the same panel key).
      if (existing.initialPath !== initialPath) {
        existing.initialPath = initialPath;
        await this.sendInit(existing.panel, initialPath);
      }
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'flowlib.panel',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview')],
      },
    );
    panel.webview.html = buildWebviewHtml({
      extensionUri: this.ctx.extensionUri,
      webview: panel.webview,
      title,
    });
    const entry: OpenPanel = { panel, initialPath };
    this.panels.set(key, entry);

    let webviewReady = false;
    let initRetryTimer: NodeJS.Timeout | undefined;

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isWebviewToHost(raw)) {
        return;
      }
      if (raw.type === 'ready') {
        webviewReady = true;
        if (initRetryTimer) {
          clearInterval(initRetryTimer);
          initRetryTimer = undefined;
        }
        void this.sendInit(panel, entry.initialPath);
      } else if (raw.type === 'log') {
        const log = getExtensionLogger();
        const { level, msg, data } = raw;
        if (level === 'error') {
          log.error(`[panel:${key}] ${msg}`, data);
        } else if (level === 'warn') {
          log.warn(`[panel:${key}] ${msg}`, data);
        } else {
          log.info(`[panel:${key}] ${msg}`, data);
        }
      }
    });

    panel.onDidDispose(() => {
      if (initRetryTimer) {
        clearInterval(initRetryTimer);
        initRetryTimer = undefined;
      }
      this.panels.delete(key);
    });

    initRetryTimer = setInterval(() => {
      if (webviewReady) {
        if (initRetryTimer) {
          clearInterval(initRetryTimer);
          initRetryTimer = undefined;
        }
        return;
      }
      void this.sendInit(panel, entry.initialPath);
    }, 1000);
  }

  private async sendInit(panel: vscode.WebviewPanel, initialPath: string): Promise<void> {
    try {
      const apiUrl = await this.getApiUrl();
      const msg: HostToWebview = { type: 'init', apiUrl, initialPath, theme: resolveTheme() };
      void panel.webview.postMessage(msg);
    } catch (err) {
      getExtensionLogger().error('InvectPanel sendInit failed', {
        error: (err as Error).message,
      });
    }
  }

  dispose(): void {
    this.themeListener.dispose();
    for (const { panel } of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}
