/**
 * `flowlib.showMcpConfig` — opens an editor tab containing the JSON
 * snippet the user pastes into Claude Code / Cursor / Claude Desktop
 * to register the embedded Flowlib server as an MCP source.
 *
 * The embedded server URL is dynamic (random loopback port chosen at
 * boot time), so this command resolves it live and inlines the right
 * URL. The shape is the same across MCP clients — only the destination
 * settings file differs.
 */

import * as vscode from 'vscode';

export interface ShowMcpConfigDeps {
  /** Resolves the embedded server URL (e.g. `http://127.0.0.1:5xxx/flowlib`). */
  getApiUrl: () => Promise<string>;
}

export function registerShowMcpConfigCommand(deps: ShowMcpConfigDeps): vscode.Disposable {
  return vscode.commands.registerCommand('flowlib.showMcpConfig', async () => {
    let apiUrl: string;
    try {
      apiUrl = await deps.getApiUrl();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Couldn't resolve the embedded server URL: ${(err as Error).message}`,
      );
      return;
    }
    const mcpEndpoint = `${apiUrl}/mcp`;

    // Render as a Markdown document so VSCode opens it with formatting +
    // the user can copy individual JSON blocks. Using a virtual untitled
    // document keeps it disposable — closing the tab discards.
    const body = renderMarkdown(mcpEndpoint);

    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: body,
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  });
}

function renderMarkdown(mcpEndpoint: string): string {
  // The same JSON shape works for Claude Code, Cursor, and Claude
  // Desktop — only the destination settings file differs. The URL
  // changes every time the extension re-activates (random loopback
  // port), so users need to re-run this command after a reload.
  const config = JSON.stringify(
    {
      mcpServers: {
        flowlib: {
          url: mcpEndpoint,
        },
      },
    },
    null,
    2,
  );
  return `# Flowlib MCP — Quick Config

Your embedded Flowlib MCP server is live at:

\`\`\`
${mcpEndpoint}
\`\`\`

Paste the JSON below into your MCP client's config. The server is
loopback-only — only your machine can reach it.

> ⚠️ The port is random and changes on every extension reload. If your MCP
> client stops responding after a reload, re-run **Flowlib: Show MCP Config**
> and paste the new URL.

---

## Claude Code

Add to \`~/.claude/settings.json\` (global) or \`.claude/settings.local.json\`
(per-workspace):

\`\`\`json
${config}
\`\`\`

Then restart Claude Code. The Flowlib tools (list flows, get flow, run,
get run logs, validate, etc.) become available to the assistant.

---

## Cursor

Add to \`~/.cursor/mcp.json\`:

\`\`\`json
${config}
\`\`\`

Cursor picks up MCP changes on chat restart.

---

## Claude Desktop

Open **Settings → Developer → Edit Config**. Add the same block:

\`\`\`json
${config}
\`\`\`

Restart Claude Desktop.

---

## Available tools

Once configured, the assistant can:

- **List flows** in the embedded backend
- **Read flow definitions** (nodes, edges, params)
- **Validate** a flow definition
- **Run a flow** with inputs
- **Read run history + logs** for debugging
- **Inspect node executions** for a given run
- **List available actions** (every \`@flowlib/actions\` provider + plugin contribution)

The assistant operates against the same in-process SQLite database the
visual editor uses — changes it makes are visible in the canvas.
`;
}
