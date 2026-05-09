import * as vscode from 'vscode';

/**
 * Workspace-trust helpers.
 *
 * The extension declares `capabilities.untrustedWorkspaces.supported: "limited"`
 * — we render the editor read-only over the JSON-footer path (no code
 * execution), and gate the evaluator fallback (jiti / Worker) on
 * `vscode.workspace.isTrusted`. Footer-less files in an untrusted workspace
 * surface a banner instead of attempting evaluation.
 */
export function isTrusted(): boolean {
  return vscode.workspace.isTrusted;
}

/**
 * HTML banner shown above (or instead of) the flow canvas when a file in an
 * untrusted workspace can't be parsed via the footer path. The "Trust
 * Workspace" button posts a `trustWorkspace` message; the host listens and
 * runs `vscode.commands.executeCommand('workbench.trust.manage')`.
 */
export function untrustedReadonlyBannerHtml(reason: string): string {
  return `
    <div style="
      padding: 1rem;
      margin: 0 0 0.75rem;
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    ">
      <div style="font-weight: 600; margin-bottom: 0.25rem;">Workspace not trusted</div>
      <div style="margin-bottom: 0.5rem;">${escapeHtml(reason)}</div>
      <button
        style="
          padding: 4px 10px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          cursor: pointer;
          font-family: var(--vscode-font-family);
        "
        onclick="(window.acquireVsCodeApi ? window.acquireVsCodeApi() : (window.__vscode || (window.__vscode = acquireVsCodeApi()))).postMessage({ type: 'trustWorkspace' })"
      >
        Trust Workspace
      </button>
    </div>
  `;
}

/** Subscribe to trust grant — provider hosts re-init on grant. */
export function onTrustChange(cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidGrantWorkspaceTrust(cb);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
