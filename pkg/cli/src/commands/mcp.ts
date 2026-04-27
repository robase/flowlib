/**
 * `npx flowlib-cli mcp` — Start the MCP server over stdio
 *
 * Connects to a running Invect instance via HTTP API and exposes
 * flow building, execution, and debugging tools over the Model Context Protocol.
 *
 * MCP clients (Claude Desktop, VS Code Copilot, Cursor, etc.) can connect
 * to this server for AI-assisted workflow development.
 *
 * Usage:
 *   npx flowlib-cli mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY
 *
 * Environment variables:
 *   INVECT_URL     — Base URL of the Invect API (default: http://localhost:3000/flowlib)
 *   INVECT_API_KEY — API key for authentication
 */

import { Command } from 'commander';
import pc from 'picocolors';

export const mcpCommand = new Command('mcp')
  .description('Start the MCP (Model Context Protocol) server over stdio')
  .option('--url <url>', 'Base URL of the Invect API', process.env.INVECT_URL)
  .option('--api-key <key>', 'API key for authentication', process.env.INVECT_API_KEY)
  .option('--print-config', 'Print MCP client configuration JSON and exit')
  .action(async (options) => {
    const url = options.url || process.env.INVECT_URL || 'http://localhost:3000/flowlib';
    const apiKey = options.apiKey || process.env.INVECT_API_KEY;

    // --print-config: output ready-to-paste MCP client config
    if (options.printConfig) {
      const config = {
        mcpServers: {
          flowlib: {
            command: 'npx',
            args: ['flowlib-cli', 'mcp', '--url', url, ...(apiKey ? ['--api-key', apiKey] : [])],
          },
        },
      };
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    if (!apiKey) {
      console.error(pc.red('Error: --api-key or INVECT_API_KEY is required.'));
      console.error('');
      console.error(pc.dim('Usage:'));
      console.error(
        pc.dim('  npx flowlib-cli mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY'),
      );
      console.error('');
      console.error(pc.dim('Or set environment variables:'));
      console.error(pc.dim('  INVECT_URL=http://localhost:3000/flowlib'));
      console.error(pc.dim('  INVECT_API_KEY=your-key'));
      process.exit(1);
    }

    // Dynamically import @flowlib/mcp to avoid bundling the MCP SDK into the CLI
    // Dynamic imports — use variable to prevent tsup from bundling these packages
    const mcpPkg = '@flowlib/mcp/cli';
    const sdkPkg = '@modelcontextprotocol/sdk/server/stdio.js';

    let HttpClient: { new (url: string, apiKey: string): unknown };
    let createMcpServer: (client: unknown) => unknown;
    let StdioServerTransport: { new (): unknown };

    try {
      const mcpModule = await import(/* @vite-ignore */ mcpPkg);
      HttpClient = mcpModule.HttpClient;
      createMcpServer = mcpModule.createMcpServer;
      const sdkModule = await import(/* @vite-ignore */ sdkPkg);
      StdioServerTransport = sdkModule.StdioServerTransport;
    } catch {
      console.error(pc.red('Error: @flowlib/mcp is not installed.'));
      console.error('');
      console.error(pc.dim('Install it with:'));
      console.error(pc.dim('  pnpm add @flowlib/mcp'));
      process.exit(1);
    }

    // Create HTTP client + MCP server
    const client = new HttpClient(url, apiKey);
    const server = createMcpServer(client);

    // Connect via stdio (stdout is the MCP protocol channel, use stderr for logs)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(pc.green(`flowlib-mcp: Connected to ${url} via stdio transport`));
    console.error(pc.dim('Waiting for MCP client messages on stdin...'));
  });
