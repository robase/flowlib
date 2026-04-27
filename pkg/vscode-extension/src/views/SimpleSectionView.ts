/**
 * Tiny tree provider used for sidebar sections that just need a single
 * "Open <X>…" entry — Credentials and Webhooks today. Each section
 * fires a command when clicked; the command opens the corresponding
 * route inside the embedded Flowlib UI.
 */

import * as vscode from 'vscode';

export interface SimpleSectionEntry {
  label: string;
  description?: string;
  iconId: string;
  command: string;
}

export class SimpleSectionViewProvider implements vscode.TreeDataProvider<SimpleSectionEntry> {
  private readonly emitter = new vscode.EventEmitter<SimpleSectionEntry | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly entries: SimpleSectionEntry[]) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(entry: SimpleSectionEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.description = entry.description;
    item.iconPath = new vscode.ThemeIcon(entry.iconId);
    item.command = { command: entry.command, title: entry.label };
    return item;
  }

  getChildren(): SimpleSectionEntry[] {
    return this.entries;
  }
}
