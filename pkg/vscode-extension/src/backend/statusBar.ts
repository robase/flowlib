/**
 * Status-bar indicator for backend connection state.
 *
 * Three states:
 *   - "● Invect: <host>"  — connected, click opens the disconnect prompt
 *   - "○ Invect: offline" — not connected, click runs `flowlib.connect`
 *   - "⚠ Invect: <host>"  — last health check failed, click retries
 *
 * Thin wrapper around `vscode.window.createStatusBarItem`. Owned by the
 * extension lifetime.
 */

import * as vscode from 'vscode';

export type ConnectionState =
  | { kind: 'embedded' }
  | { kind: 'offline' }
  | { kind: 'connected'; url: string }
  | { kind: 'error'; url: string; message: string };

export class BackendStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.show();
    this.set({ kind: 'embedded' });
  }

  set(state: ConnectionState): void {
    switch (state.kind) {
      case 'embedded':
        this.item.text = '$(home) Invect: embedded';
        this.item.tooltip =
          'Embedded local backend (SQLite). Click to connect to a remote backend.';
        this.item.command = 'flowlib.connect';
        this.item.backgroundColor = undefined;
        return;
      case 'offline':
        this.item.text = '$(circle-large-outline) Invect: offline';
        this.item.tooltip = 'Click to connect to an Invect backend or use the embedded backend';
        this.item.command = 'flowlib.connect';
        this.item.backgroundColor = undefined;
        return;
      case 'connected':
        this.item.text = `$(circle-filled) Invect: ${displayHost(state.url)}`;
        this.item.tooltip = `Connected to ${state.url}\nClick to disconnect (returns to embedded backend)`;
        this.item.command = 'flowlib.disconnect';
        this.item.backgroundColor = undefined;
        return;
      case 'error':
        this.item.text = `$(warning) Invect: ${displayHost(state.url)}`;
        this.item.tooltip = `Backend error: ${state.message}\nClick to retry`;
        this.item.command = 'flowlib.connect';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

function displayHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
