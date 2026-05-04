import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'backend/index': 'src/backend/index.ts',
    'browser/index': 'src/browser.ts',
    'frontend/index': 'src/frontend/index.ts',
    'shared/types': 'src/shared/types.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@flowlib/user-auth',
      '@flowlib/ui',
      'kysely',
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'lucide-react',
      'clsx',
      'tailwind-merge',
    ],
  },
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
