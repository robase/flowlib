# Module-level singleton audit (PR 14/14)

Tracks `pkg/core/src/` module-level state that must (or must not) be demoted to per-`InvectInstance` ownership for multi-isolate runtimes (Cloudflare Workers, Deno Deploy).

Categories:

- **(a) safe-to-keep** — genuinely stateless cache (e.g., parsed WASM module). Singleton scope is fine across isolates because nothing tenant-scoped is held.
- **(b) must-be-instance** — cross-request state (event subscriptions, sessions, maps keyed by runtime identity). Single-process assumption breaks under multi-isolate.

## Findings

| File:line                                      | Name                                                      | Cat                               | Action this PR                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/execution-event-bus.ts:128`          | `globalBus` / `getExecutionEventBus()`                    | **(b)**                           | Already partly-demoted by PR 8 (`ExecutionEventBus implements ExecutionEventBusAdapter`); the module-level singleton is retained for back-compat but every internal caller goes through `serviceFactory.getExecutionEventBus()`. Future deprecation: full removal once vscode-extension migrates. |
| `services/templating/template.service.ts`      | `defaultInstance` / `getTemplateService()`                | **(b)**                           | **Demoted in this PR.** `getTemplateService()` is now a deprecated pass-through that always returns a fresh instance (no memoization). `createTemplateService()` is the canonical factory; callers in `create-flowlib.ts`/`flowlib-core.ts` already use it.                                         |
| `services/templating/js-expression.service.ts` | `defaultInstance` / `getJsExpressionService()`            | **(b) instance / (a) WASM cache** | **Demoted in this PR** — service instance no longer memoized. The underlying QuickJS WASM module cache (`getQuickJS()` from `quickjs-emscripten`) stays — that's a stateless parsed-WASM cache, safe across isolates.                                                                             |
| `actions/action-registry.ts`                   | `globalActionRegistry` (re-export from `@flowlib/actions`) | **(a) cache / (b) mutable**       | Out of scope (lives in `@flowlib/actions`, not `pkg/core/src/`). Catalog content is stateless but the `set/initialize/reset` accessors mean it's mutable global state. **Flagged for follow-up** — should expose per-instance `ActionRegistry` on `InvectInstance`.                                |
| `services/credentials/oauth2.service.ts:77`    | `pendingStates: Map<string, OAuthState>`                  | **(b)**                           | Cross-request CSRF state. PR 5 (already merged) removed the module-level `setInterval` cleanup; the Map itself remains module-level. **Flagged for follow-up** — needs DO-backed storage in hosted variant.                                                                                       |
| `utils/url-safe-id.ts:58`                      | `globalThis.crypto.getRandomValues`                       | n/a                               | Runtime API use, not a singleton. No action.                                                                                                                                                                                                                                                      |

## What's done in this PR

- `getTemplateService()` no longer memoizes — every call returns a fresh `TemplateService`. Existing `resetTemplateService()` retained for back-compat (now a no-op when nothing is memoized).
- `getJsExpressionService()` no longer memoizes the service instance. The WASM module cache (inside `quickjs-emscripten`) is unaffected.
- The audit above documents what's still pending.

## Deferred to follow-up PRs

- Full demotion of `getExecutionEventBus()` (needs vscode-extension migration).
- `globalActionRegistry` per-instance ownership (lives in `@flowlib/actions`, separate package).
- OAuth2 pending-states map → DO-backed store for hosted variant (separate concern from upstream cleanup).
