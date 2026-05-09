import * as vscode from 'vscode';

/**
 * Tracks a set of disposables that can be disposed together.
 *
 * Used by per-editor / per-webview lifecycles so that closing a panel
 * tears down all of its listeners in one call.
 */
export class DisposableStore implements vscode.Disposable {
  private readonly items: vscode.Disposable[] = [];
  private isDisposed = false;

  add<T extends vscode.Disposable>(disposable: T): T {
    if (this.isDisposed) {
      // Caller created a disposable after the store was torn down — dispose
      // immediately so we don't leak the underlying resource.
      disposable.dispose();
      return disposable;
    }
    this.items.push(disposable);
    return disposable;
  }

  addMany(disposables: ReadonlyArray<vscode.Disposable>): void {
    for (const d of disposables) {
      this.add(d);
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    while (this.items.length > 0) {
      const item = this.items.pop();
      try {
        item?.dispose();
      } catch {
        // Swallow — disposal must not throw past the boundary.
      }
    }
  }
}

/** Trivial disposable wrapper around an arbitrary cleanup function. */
export function toDisposable(fn: () => void): vscode.Disposable {
  return { dispose: fn };
}
