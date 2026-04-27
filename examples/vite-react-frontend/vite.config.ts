import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

const pkg = (p: string) => path.resolve(__dirname, '../../pkg', p);

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      // Subpath aliases must come before their package root alias.
      // Use exact regex so @flowlib/ui/styles etc. are not caught.
      {
        find: /^@flowlib\/version-control\/providers\/github$/,
        replacement: pkg('plugins/version-control/src/providers/github.browser.ts'),
      },
      {
        find: /^@flowlib\/version-control$/,
        replacement: pkg('plugins/version-control/src/browser.ts'),
      },
      { find: /^@flowlib\/user-auth$/, replacement: pkg('plugins/auth/src/browser.ts') },
      { find: /^@flowlib\/rbac$/, replacement: pkg('plugins/rbac/src/browser.ts') },
      { find: /^@flowlib\/webhooks$/, replacement: pkg('plugins/webhooks/src/browser.ts') },
      { find: /^@flowlib\/mcp$/, replacement: pkg('plugins/mcp/src/browser.ts') },
      {
        find: /^@flowlib\/vercel-workflows$/,
        replacement: pkg('plugins/vercel-workflows/src/browser.ts'),
      },
      { find: /^@flowlib\/layouts$/, replacement: pkg('layouts/src/index.ts') },
      { find: /^@flowlib\/ui$/, replacement: pkg('ui/src/index.ts') },
      { find: /^@flowlib\/action-kit$/, replacement: pkg('action-kit/src/index.ts') },
      { find: /^@flowlib\/sdk$/, replacement: pkg('sdk/src/index.ts') },
      // @flowlib/actions/<provider> subpath resolution — the SDK's node
      // helpers import from these (`@flowlib/actions/core`, `.../http`, etc.).
      // Capture the subpath and map to the matching provider directory in
      // pkg/actions/src.
      {
        find: /^@flowlib\/actions\/([^/]+)$/,
        replacement: pkg('actions/src/$1/index.ts'),
      },
      { find: /^@flowlib\/actions$/, replacement: pkg('actions/src/index.ts') },
    ],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@xyflow/react',
      '@tanstack/react-query',
      'use-sync-external-store',
      'use-sync-external-store/shim',
    ],
  },
  build: {
    rollupOptions: {
      external: [/^@flowlib\/core/],
    },
  },
  server: {
    hmr: {
      overlay: false,
    },
    watch: {
      // pnpm symlinks workspace packages into node_modules — un-ignore them so
      // Vite picks up dist rebuilds from pkg/* without a manual restart.
      ignored: (p: string) => p.includes('node_modules') && !p.includes('node_modules/@flowlib'),
    },
    proxy: {
      '/api/flowlib': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
