/**
 * Vite config for Docker production builds.
 * Removes the @flowlib/core external (needed for dev server, breaks static serving)
 * and the dev server proxy (not needed in production).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
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
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // No externals — bundle everything for static serving
  },
});
