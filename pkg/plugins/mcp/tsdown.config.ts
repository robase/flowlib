import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'backend/index': 'src/backend/index.ts',
    'browser/index': 'src/browser.ts',
    'shared/types': 'src/shared/types.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@flowlib/sdk',
      '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/sdk/server/mcp.js',
      '@modelcontextprotocol/sdk/server/stdio.js',
      '@modelcontextprotocol/sdk/server/streamableHttp.js',
      'zod',
    ],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
