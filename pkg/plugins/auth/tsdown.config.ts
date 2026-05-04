import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'backend/index': 'src/backend/index.ts',
    'browser/index': 'src/browser.ts',
    'frontend/index': 'src/frontend/index.ts',
    'shared/types': 'src/shared/types.ts',
    // Kysely type contract for `flowlib_flow_access` (auth-owned, RBAC-consumed).
    // Migration emission for this table flows through the abstract
    // `AUTH_SCHEMA` declaration in `plugin.ts` + `flowlib-cli generate` —
    // we don't ship per-dialect Drizzle table objects from auth anymore.
    'kysely-types': 'src/backend/kysely-types.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@flowlib/ui',
      'better-auth',
      'better-auth/plugins',
      'better-auth/adapters/drizzle',
      'better-sqlite3',
      'kysely',
      'pg',
      'mysql2',
      'mysql2/promise',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-router',
      '@tanstack/react-query',
      'lucide-react',
    ],
  },
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.mjs',
    };
  },
});
