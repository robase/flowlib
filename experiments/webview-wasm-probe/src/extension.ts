import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUTPUT_CHANNEL = 'Flowlib WASM Probe';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  context.subscriptions.push(output);

  output.appendLine('[probe] Extension activated');

  // Auto-run when PROBE_AUTORUN=1 is set in the environment (for headless CI).
  // In interactive use, the user invokes the command via the palette.
  if (process.env.PROBE_AUTORUN === '1') {
    output.appendLine('[probe] PROBE_AUTORUN=1 — firing probe.run automatically');
    setTimeout(() => vscode.commands.executeCommand('probe.run'), 200);
  }

  const disposable = vscode.commands.registerCommand('probe.run', async () => {
    output.appendLine('[probe] probe.run invoked');
    output.show(true);

    const panel = vscode.window.createWebviewPanel(
      'flowlibWasmProbe',
      'Flowlib WASM Probe',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      },
    );

    const webview = panel.webview;
    const nonce = generateNonce();
    const mainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'main.js'),
    );

    // Exact CSP from VSCODE_EXTENSION_TASKS.md Part 1.4
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: https:`,
      `connect-src 'none'`,
    ].join('; ');

    webview.html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Flowlib WASM Probe</title>
    <style>
      body { font-family: var(--vscode-editor-font-family, monospace); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
      h1 { font-size: 14px; margin-top: 16px; }
      pre { background: var(--vscode-textBlockQuote-background, #1e1e1e); border: 1px solid var(--vscode-panel-border, #333); padding: 8px; white-space: pre-wrap; font-size: 12px; }
      .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
      .err { color: var(--vscode-errorForeground, #f85149); }
    </style>
  </head>
  <body>
    <h1>Flowlib VSCode Webview + QuickJS WASM Probe</h1>
    <div id="status">Initializing…</div>
    <h1>Results</h1>
    <pre id="results">(pending)</pre>
    <h1>CSP applied</h1>
    <pre id="csp">${escapeHtml(csp)}</pre>
    <script nonce="${nonce}" src="${mainUri}"></script>
  </body>
</html>`;

    const ready = new Promise<void>((resolve) => {
      const sub = webview.onDidReceiveMessage((msg) => {
        if (!msg || typeof msg !== 'object') {
          return;
        }
        if (msg.type === 'log') {
          output.appendLine(`[webview ${msg.level ?? 'info'}] ${msg.message}`);
        } else if (msg.type === 'result') {
          output.appendLine(`[probe] RESULT: success=${msg.success} duration=${msg.durationMs}ms`);
          output.appendLine(`[probe] value=${JSON.stringify(msg.value)}`);
          if (msg.error) {
            output.appendLine(`[probe] error=${msg.error}`);
          }
          // Persist the result to a file for headless runs.
          try {
            const dest =
              process.env.PROBE_RESULT_FILE ||
              path.join(context.extensionPath, 'dist', 'result.json');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(
              dest,
              JSON.stringify(
                {
                  success: msg.success,
                  value: msg.value,
                  error: msg.error,
                  durationMs: msg.durationMs,
                  timings: msg.timings,
                  vscodeVersion: vscode.version,
                  platform: process.platform,
                  arch: process.arch,
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            );
            output.appendLine(`[probe] result written to ${dest}`);
          } catch (e) {
            output.appendLine(`[probe] failed to write result file: ${String(e)}`);
          }
          resolve();
          if (process.env.PROBE_AUTORUN === '1') {
            // Exit after short delay so logs flush.
            setTimeout(() => {
              output.appendLine('[probe] AUTORUN done — closing');
              // Use internal close command to exit the Extension Host.
              vscode.commands.executeCommand('workbench.action.quit');
            }, 500);
          }
        } else if (msg.type === 'ready') {
          output.appendLine('[probe] Webview signalled ready');
        }
      });
      panel.onDidDispose(() => {
        sub.dispose();
        resolve();
      });
    });

    await ready;
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {
  /* nothing */
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
