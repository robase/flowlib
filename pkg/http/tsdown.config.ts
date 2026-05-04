import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: false },
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['@flowlib/core', 'zod'],
  },
  outExtensions({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
