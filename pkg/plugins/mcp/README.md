<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/mcp</h1>

<p align="center">
  Model Context Protocol server for Flowlib.
  <br />
  <a href="https://flowlib.dev/docs/plugins"><strong>Docs</strong></a>
</p>

---

Exposes Flowlib flow building, editing, execution, and debugging as MCP tools. Works with Claude Desktop, VS Code Copilot, Cursor, and any MCP-compatible client.

## Install

```bash
pnpm add @flowlib/mcp
```

## Backend Plugin

Add the MCP plugin to enable the Streamable HTTP transport endpoint:

```ts
import { mcp } from '@flowlib/mcp';

const flowlibRouter = await createFlowlibRouter({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY,
  plugins: [mcp()],
});

app.use('/flowlib', flowlibRouter);
```

### Options

```ts
mcp({
  sessionTtlMs: 30 * 60 * 1000, // Session TTL (default: 30 minutes)
  audit: {
    enabled: true, // Enable audit logging (default: true)
    persist: false, // Persist audit logs to database (default: false)
    logLevel: 'info', // Log level (default: 'info')
  },
});
```

## Standalone CLI

For AI coding agents that use stdio transport (Claude Desktop, VS Code Copilot), run the MCP server as a standalone process:

```bash
npx flowlib-mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "flowlib": {
      "command": "npx",
      "args": ["flowlib-mcp", "--url", "http://localhost:3000/flowlib"]
    }
  }
}
```

## MCP Tools

| Category        | Tools                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| **Flows**       | `flow_list`, `flow_get`, `flow_create`, `flow_update`, `flow_delete`, `flow_validate`      |
| **Versions**    | `version_list`, `version_get`, `version_publish`                                           |
| **Runs**        | `run_start`, `run_to_node`, `run_list`, `run_get`, `run_cancel`, `run_pause`, `run_resume` |
| **Debug**       | `debug_node_executions`, `debug_test_node`, `debug_test_expression`, `debug_test_mapper`   |
| **Credentials** | Credential CRUD and secrets management                                                     |
| **Triggers**    | Trigger CRUD operations                                                                    |
| **Nodes**       | Query available node types and providers                                                   |

## Exports

| Entry Point         | Content                     |
| ------------------- | --------------------------- |
| `@flowlib/mcp`       | Backend plugin (Node.js)    |
| `@flowlib/mcp/types` | Shared types                |
| `flowlib-mcp` (bin)  | Standalone stdio MCP server |

## License

[MIT](../../../LICENSE)
