import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/schema-sqlite.ts', 'src/schema-postgres.ts', 'src/schema-mysql.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: false },
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['drizzle-orm', '@flowlib/action-kit'],
  },
  outExtensions({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
