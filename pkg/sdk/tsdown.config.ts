import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/transform/index.ts',
    'src/evaluator/index.ts',
    'src/generated/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: { resolve: false },
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['@flowlib/action-kit', '@flowlib/actions', 'zod', 'typescript', 'jiti'],
  },
  outExtensions({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
