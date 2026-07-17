/**
 * Vitest config for `@flowlib/agents`.
 *
 * Three projects, because the plugin's tests genuinely need three
 * different runtimes. `pnpm --filter @flowlib/agents test` runs all of
 * them; `--project workers` / `node` / `frontend` narrows.
 *
 * - **workers** — the Cloudflare `workerd` runtime via
 *   `@cloudflare/vitest-pool-workers`. The pool boots a real `workerd`
 *   isolate per test file, so code that imports `cloudflare:workers`,
 *   accesses Durable Objects, or touches Workers-only globals
 *   (`crypto.subtle`, `caches`, `WebSocketPair`, …) is exercised in the
 *   same environment it runs in production.
 *
 * - **node** — plain Node. Tests whose module graph reaches `@flowlib/core`
 *   cannot load inside `workerd`: core pulls in Node-only heavyweights
 *   (the TypeScript compiler, QuickJS, drizzle) and the isolate dies on
 *   import. Before this split, `src/backend/__tests__/plugin.test.ts` was
 *   in the workers project, crashed the pool worker on import, and
 *   silently contributed **zero** tests while making the whole run exit 1.
 *   Anything that imports `../plugin` (or otherwise pulls core) belongs
 *   here.
 *
 * - **frontend** — `happy-dom`. React component/hook tests. Previously
 *   these lived in an unreferenced `vitest.frontend.config.ts` and the
 *   root `include` only matched `*.test.ts`, so no `.tsx` test ran at all.
 *
 * Eval harness self-tests are separate again — see `eval/vitest.config.ts`,
 * run via `pnpm --filter @flowlib/agents eval:test`.
 */
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defaultExclude, defineConfig } from 'vitest/config';

/**
 * Tests that must run in Node rather than `workerd`, because their import
 * graph reaches `@flowlib/core`. Kept as an explicit list (rather than a
 * directory convention) so adding one is a deliberate, reviewable act.
 */
const NODE_ONLY_TESTS = ['src/backend/__tests__/plugin.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              // Latest compatibility date supporting modern bindings + DO migrations.
              compatibilityDate: '2025-01-01',
              compatibilityFlags: ['nodejs_compat'],
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
          // Spread the defaults back in — a bare `exclude` *replaces* them
          // (dropping node_modules, dist, …) rather than adding to them.
          exclude: [...defaultExclude, ...NODE_ONLY_TESTS],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          pool: 'forks',
          include: NODE_ONLY_TESTS,
        },
      },
      {
        test: {
          name: 'frontend',
          environment: 'happy-dom',
          pool: 'forks',
          include: ['src/**/*.test.tsx'],
          server: {
            deps: {
              // Ship-as-ESM packages that resolve React through CJS; without
              // inlining, `agents/react` fails on `Named export 'use' not found`
              // and `@flowlib/ui`'s prebundled dist touches `document` at import.
              inline: ['agents', '@flowlib/ui'],
            },
          },
        },
      },
    ],
  },
});
