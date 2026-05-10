/**
 * Frontend-only Vitest config for `@flowlib/agents`.
 *
 * The default `vitest.config.ts` uses `@cloudflare/vitest-pool-workers`,
 * which runs tests in workerd — that runtime has no DOM, and the
 * project doesn't depend on `jsdom` / `happy-dom`, so it cannot
 * exercise `@testing-library/react`'s `render()`.
 *
 * This separate config skips the workers pool and runs the
 * `__tests__/*.test.tsx` files in plain Node. The Stream L scaffold
 * tests rely on `react-dom/server`'s `renderToString` for assertions,
 * which works without a DOM. When jsdom or happy-dom is added to the
 * workspace later, switch `environment` here to `'jsdom'` to unlock
 * full RTL `render()` + interaction testing.
 *
 * Run with: `pnpm --filter @flowlib/agents exec vitest run -c vitest.frontend.config.ts`
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Stream L (page tests) and Stream M (chat surface tests) both opt
    // into this config. Both use `react-dom/server`'s `renderToString`
    // for structural assertions — no DOM required. The brief mentions
    // the codebase moved from `imp-*` to `fl-*` theme tokens; Stream L
    // tests still reference `imp-*` strings (will need a follow-up to
    // align with the live CSS in `pkg/ui/src/app.css`).
    include: [
      'src/frontend/__tests__/AgentsPage.test.tsx',
      'src/frontend/__tests__/AgentFormPage.test.tsx',
      'src/frontend/__tests__/AgentDetailPage.test.tsx',
      // Stream M — chat surface
      'src/frontend/__tests__/MessageBubble.test.tsx',
      'src/frontend/__tests__/ToolCallCard.test.tsx',
      'src/frontend/__tests__/ChatStream.test.tsx',
      'src/frontend/__tests__/useChatStream.test.tsx',
    ],
    pool: 'forks',
  },
});
