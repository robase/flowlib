/**
 * Single source of truth for the MCP server's advertised name + version.
 *
 * Reads the package.json version at runtime from the installed package root.
 * Works for both ESM and CJS builds — tsdown rewrites `import.meta.url` into
 * the appropriate form for each output, and `createRequire` handles the CJS
 * side natively.
 */
import { createRequire } from 'node:module';

function readVersion(): string {
  try {
    // In ESM, import.meta.url points at the compiled file; in CJS it's a
    // polyfill provided by tsdown. Either way, createRequire resolves
    // relative to that location, so the installed package.json is one dir up
    // from `dist/shared/` (i.e. `dist/../package.json`).
    const req = createRequire(import.meta.url);
    const pkg = req('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const MCP_SERVER_NAME = 'flowlib-mcp';
export const MCP_SERVER_VERSION = readVersion();
export const MCP_PROTOCOL_VERSION = '2025-03-26';
