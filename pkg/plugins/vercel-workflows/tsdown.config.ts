import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    'runtime/index': 'src/runtime/index.ts',
    'compiler/index': 'src/compiler/index.ts',
    'frontend/index': 'src/frontend/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@flowlib/primitives',
      '@flowlib/sdk',
      '@flowlib/ui',
      'react',
      'react-dom',
      'lucide-react',
      'zod',
    ],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
