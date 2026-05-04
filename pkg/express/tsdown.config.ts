import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'router/index': 'src/flowlib-router.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  report: false,
  unbundle: true,
  deps: {
    neverBundle: ['@flowlib/core', '@flowlib/http', 'express', 'cors', 'zod'],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
