/**
 * Activity-bar tree showing the available backends and which is active.
 *
 * Items:
 *   - "● Embedded (local SQLite)" — always present, default
 *   - "● Remote: <url>"           — present iff `flowlib.backendUrl` is set
 *   - "Connect to remote…"        — action row, fires `flowlib.connect`
 *
 * Active backend gets `$(check)` + bold; inactive gets `$(circle-outline)`.
 * Clicking a backend item switches to it (calls connect/disconnect under
 * the hood). Refreshes when `setActiveKind()` is called from the
 * extension's lifecycle owner.
 */

import * as vscode from 'vscode';
import { readConfig } from '../util/config';

export type ActiveBackendKind = 'embedded' | 'http' | 'disconnected';

interface BackendItem {
  kind: 'embedded' | 'remote' | 'connect-action';
  url?: string;
  active: boolean;
}

export class BackendsExplorerProvider implements vscode.TreeDataProvider<BackendItem> {
  private readonly emitter = new vscode.EventEmitter<BackendItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private active: ActiveBackendKind = 'embedded';

  setActiveKind(kind: ActiveBackendKind): void {
    this.active = kind;
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(item: BackendItem): vscode.TreeItem {
    if (item.kind === 'embedded') {
      const tree = new vscode.TreeItem('Embedded (local SQLite)');
      tree.description = item.active ? 'active' : undefined;
      tree.iconPath = new vscode.ThemeIcon(item.active ? 'check' : 'home');
      tree.tooltip = item.active
        ? 'In-process @flowlib/core against a local SQLite file in this extension\'s globalStorage. Click "Disconnect" on a remote backend to return here.'
        : 'Switch to the embedded local backend. Disconnects any remote backend.';
      tree.command = item.active
        ? undefined
        : { command: 'flowlib.disconnect', title: 'Use embedded backend' };
      tree.contextValue = 'flowlib.backend.embedded';
      return tree;
    }

    if (item.kind === 'remote') {
      const tree = new vscode.TreeItem(item.url ?? 'Remote');
      tree.description = item.active ? 'active' : 'configured';
      tree.iconPath = new vscode.ThemeIcon(item.active ? 'check' : 'cloud');
      tree.tooltip = item.active
        ? `Connected to ${item.url}\nClick to reconnect / change URL.`
        : `Configured but not active.\nClick to connect to ${item.url}.`;
      tree.command = { command: 'flowlib.connect', title: 'Connect to remote backend' };
      tree.contextValue = 'flowlib.backend.remote';
      return tree;
    }

    // connect-action
    const tree = new vscode.TreeItem('Connect to remote backend…');
    tree.iconPath = new vscode.ThemeIcon('plug');
    tree.tooltip = 'Configure a remote (or localhost / Docker) Flowlib backend';
    tree.command = { command: 'flowlib.connect', title: 'Connect…' };
    tree.contextValue = 'flowlib.backend.connect';
    return tree;
  }

  getChildren(): BackendItem[] {
    const config = readConfig();
    const url = config.backendUrl?.trim() || undefined;

    const items: BackendItem[] = [{ kind: 'embedded', active: this.active === 'embedded' }];
    if (url) {
      items.push({ kind: 'remote', url, active: this.active === 'http' });
    } else {
      items.push({ kind: 'connect-action', active: false });
    }
    return items;
  }
}
