/**
 * Webview HTML scaffolding.
 *
 * `'wasm-unsafe-eval'` keeps QuickJS template-preview viable. `connect-src`
 * is opened to the in-process Express server's loopback URL so the embedded
 * `<Flowlib>` UI can `fetch` the local backend; otherwise a strict CSP.
 */

import * as vscode from 'vscode';

export interface BuildHtmlOptions {
  /** Root URI of the extension; used to resolve `dist/webview/*` assets. */
  extensionUri: vscode.Uri;
  /** The panel's `webview` — needed for `cspSource` and `asWebviewUri`. */
  webview: vscode.Webview;
  /** Page title shown in the panel tab. Defaults to "Flowlib Flow". */
  title?: string;
  /**
   * Origin (scheme://host:port) of the in-process backend the webview
   * will fetch. Whitelisted in `connect-src` so Flowlib's `ApiClient`
   * can reach it. SSE uses the same origin.
   */
  apiOrigin?: string;
}

export function buildWebviewHtml(opts: BuildHtmlOptions): string {
  const { extensionUri, webview, title = 'Flowlib Flow', apiOrigin } = opts;
  const nonce = generateNonce();
  const webviewDir = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'main.js'));
  // Vite (with `cssCodeSplit: false` + `assetFileNames: '[name][extname]'`)
  // emits all imported CSS into one `style.css`. Our host builds its own HTML
  // (replacing Vite's index.html), so we have to load it explicitly here.
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'style.css'));

  const connectSources: string[] = [];
  if (apiOrigin) {
    connectSources.push(apiOrigin);
  }
  // Fall back to allowing any 127.0.0.1 / localhost port — covers cases
  // where the apiOrigin isn't known at HTML-build time (rare) and
  // future remote-backend support over plain HTTP localhost tunnels.
  connectSources.push('http://127.0.0.1:*', 'http://localhost:*');
  // Allow the webview-resource scheme so devtools can fetch sourcemaps
  // (`https://file+.vscode-resource.vscode-cdn.net/...js.map`). Without
  // this the browser console fills with CSP violations on every map
  // hover, even in production builds where maps exist.
  connectSources.push(webview.cspSource);

  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `img-src ${webview.cspSource} data: https:`,
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${styleUri.toString()}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
  </body>
</html>`;
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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
