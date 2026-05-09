/**
 * Text-document ↔ webview sync.
 *
 * Owns the version tracking that breaks the otherwise-inevitable feedback
 * loop:
 *
 *   webview edit
 *     → host applies WorkspaceEdit
 *       → onDidChangeTextDocument fires for the same version we just wrote
 *         → host re-emits to webview
 *           → webview re-emits to host
 *             → infinite ping-pong
 *
 * `pendingVersions` tracks document versions we *expect* to produce ourselves;
 * the `onDidChangeTextDocument` handler calls `isOurEdit(e)` and ignores any
 * change whose version we authored.
 *
 * Per-URI debouncing lives in `Debouncer` so the editor coalesces the
 * pulse-train of canvas drag events into a single WorkspaceEdit (default
 * 400ms, configurable via `flowlib.autoSaveDebounceMs`).
 */

import * as vscode from 'vscode';
import type { SdkFlowDefinition } from '@flowlib/sdk';
import { emitFlowFile } from '../flow-file/emit';

export class TextSync {
  private readonly pendingVersions = new Set<number>();

  /**
   * Returns `true` if the change event was triggered by our own
   * `applyEdit`. The version is consumed on first match so a later
   * external edit at the same numeric version still propagates.
   */
  isOurEdit(e: vscode.TextDocumentChangeEvent): boolean {
    if (this.pendingVersions.has(e.document.version)) {
      this.pendingVersions.delete(e.document.version);
      return true;
    }
    return false;
  }

  /**
   * Apply a new flow definition to the underlying text document. Idempotent
   * when the emitted source is identical to the current text.
   *
   * Caller is responsible for debouncing — see `Debouncer`.
   */
  async apply(doc: vscode.TextDocument, newFlow: SdkFlowDefinition): Promise<void> {
    const oldSrc = doc.getText();
    const newSrc = emitFlowFile(newFlow);
    if (oldSrc === newSrc) {
      return;
    }
    const expectedVersion = doc.version + 1;
    this.pendingVersions.add(expectedVersion);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(oldSrc.length));
    edit.replace(doc.uri, fullRange, newSrc);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      // Edit was rejected (concurrent modification etc.). Clear the
      // expectation so a later real edit at this version isn't mistaken
      // for ours.
      this.pendingVersions.delete(expectedVersion);
    }
  }
}

/**
 * URI-keyed debouncer. Each URI gets its own pending timer / pending value.
 *
 * `schedule(key, value)` overwrites any pending value for the same key and
 * resets the timer. When the timer fires, the callback receives the most
 * recently scheduled value.
 *
 * `flush(key)` runs the callback immediately and cancels the timer.
 * `cancel(key)` discards without invoking.
 */
export class Debouncer<T> {
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; value: T }>();
  private windowMs: number;

  constructor(
    private readonly fn: (key: string, value: T) => void | Promise<void>,
    initialWindowMs: number,
  ) {
    this.windowMs = Math.max(0, initialWindowMs);
  }

  setWindowMs(ms: number): void {
    this.windowMs = Math.max(0, ms);
  }

  schedule(key: string, value: T): void {
    const prev = this.pending.get(key);
    if (prev) {
      clearTimeout(prev.timer);
    }
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.fn(key, value);
    }, this.windowMs);
    this.pending.set(key, { timer, value });
  }

  flush(key: string): void {
    const slot = this.pending.get(key);
    if (!slot) {
      return;
    }
    clearTimeout(slot.timer);
    this.pending.delete(key);
    void this.fn(key, slot.value);
  }

  cancel(key: string): void {
    const slot = this.pending.get(key);
    if (!slot) {
      return;
    }
    clearTimeout(slot.timer);
    this.pending.delete(key);
  }

  cancelAll(): void {
    for (const [, slot] of this.pending) {
      clearTimeout(slot.timer);
    }
    this.pending.clear();
  }
}
