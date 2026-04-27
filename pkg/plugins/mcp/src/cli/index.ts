#!/usr/bin/env node
/**
 * flowlib-mcp CLI — Standalone MCP server over stdio transport.
 *
 * Connects to a running Flowlib instance via HTTP API.
 * Designed for Claude Desktop, VS Code Copilot, and other MCP clients.
 *
 * Usage:
 *   npx flowlib-mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY
 *
 * Environment variables:
 *   FLOWLIB_URL     — Base URL of the Flowlib API
 *   FLOWLIB_API_KEY — API key for authentication
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpClient } from '../backend/client/http-client';
import { createMcpServer } from '../backend/mcp-server';

// Re-export building blocks so @flowlib/cli can import them
export { HttpClient } from '../backend/client/http-client';
export { createMcpServer } from '../backend/mcp-server';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const url = args.url || process.env.FLOWLIB_URL;
  const apiKey = args['api-key'] || process.env.FLOWLIB_API_KEY;

  if (!url) {
    process.stderr.write('Error: --url or FLOWLIB_URL is required.\n');
    process.stderr.write(
      'Usage: flowlib-mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY\n',
    );
    process.exit(1);
  }

  if (!apiKey) {
    process.stderr.write('Error: --api-key or FLOWLIB_API_KEY is required.\n');
    process.stderr.write(
      'Usage: flowlib-mcp --url http://localhost:3000/flowlib --api-key YOUR_KEY\n',
    );
    process.exit(1);
  }

  // Create HTTP client pointing at the remote Flowlib API
  const client = new HttpClient(url, apiKey);

  // Create MCP server with all tools
  const server = createMcpServer(client);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used by the MCP protocol)
  process.stderr.write(`flowlib-mcp: Connected to ${url} via stdio transport\n`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

main().catch((err) => {
  process.stderr.write(`flowlib-mcp: Fatal error: ${err}\n`);
  process.exit(1);
});
