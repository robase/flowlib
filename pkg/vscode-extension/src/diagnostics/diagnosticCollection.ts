/**
 * Per-URI diagnostic collection lifecycle.
 *
 * Owns a single `vscode.DiagnosticCollection` named `flowlib`. Other lanes
 * (L5's `FlowEditorProvider`, L9's untrusted-mode banner) call `set(uri, ...)`
 * after parsing/validating a flow document, and `clear(uri)` on close.
 *
 * Wrapper kept thin so the test surface is the diagnostic *producer*
 * (`flowDiagnostics.ts`), not the collection mechanics.
 */

import * as vscode from 'vscode';

export class FlowDiagnosticManager implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(name = 'flowlib') {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  set(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
    this.collection.set(uri, diagnostics);
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  clearAll(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }

  /** Test-only access for assertion convenience. */
  get(uri: vscode.Uri): readonly vscode.Diagnostic[] | undefined {
    return this.collection.get(uri);
  }
}
