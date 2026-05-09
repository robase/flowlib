import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'backend/index': 'src/index.ts',
    'browser/index': 'src/browser.ts',
    'frontend/index': 'src/frontend/types.ts',
    'shared/types': 'src/shared/types.ts',
    'shared/events': 'src/shared/events.ts',
    'shared/auth-context': 'src/shared/auth-context.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@flowlib/action-kit',
      '@flowlib/actions',
      '@flowlib/actions/registry',
      '@flowlib/db',
      '@flowlib/ui',
      '@anthropic-ai/claude-agent-sdk',
      '@cloudflare/sandbox',
      '@cloudflare/workers-types',
      '@opencode-ai/sdk',
      'agents',
      'react',
      'react-dom',
      'react/jsx-runtime',
    ],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
