import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'backend/index': 'src/backend/index.ts',
    'compiler/index': 'src/compiler/index.ts',
    'shared/types': 'src/shared/types.ts',
    'adapter/index': 'src/adapter/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['@flowlib/core', '@flowlib/primitives', 'zod'],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
