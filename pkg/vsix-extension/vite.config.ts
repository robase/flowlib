import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the webview bundle.
 *
 * Single-file output (assetsInlineLimit: Infinity) keeps the .vsix small and
 * avoids extra `localResourceRoots` entries for chunked assets.
 *
 * Output:
 *   dist/webview/main.js
 *   dist/webview/index.html
 */
export default defineConfig({
  // Set the project root to the `webview/` folder so Vite treats `index.html`
  // as the entry and emits sibling assets at the top level of `outDir`
  // (otherwise the html is nested under `outDir/webview/index.html`).
  root: resolve(__dirname, 'webview'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        manualChunks: undefined,
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    // Force a single copy of React + react-router across the bundle. Without
    // this the workspace's hoisting can pull two Reacts (one for `react-dom`,
    // one for `@flowlib/ui`) and the `$$typeof` symbol mismatch produces
    // React error #31. Same problem for `react-router`: two copies → two
    // separate React contexts → our outer `<MemoryRouter>` is invisible to
    // `@flowlib/ui`'s `useInRouterContext()`, so Flowlib falls back to
    // BrowserRouter and reads `window.location` (which inside a webview is
    // garbage like `/index.html?id=...`).
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router',
      '@tanstack/react-query',
    ],
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react-router': resolve(__dirname, 'node_modules/react-router'),
      '@tanstack/react-query': resolve(__dirname, 'node_modules/@tanstack/react-query'),
    },
  },
});
