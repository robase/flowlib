# Lazy Action Migration

Tracks which providers have been migrated to the `LazyActionDefinition`
pattern. The goal is to keep edge-runtime bundles (Cloudflare Workers,
Vercel Workflows) under their cold-start size caps by deferring provider-SDK
imports until the action actually runs.

## How it works

Each provider exposes two arrays:

- `xxxActions: ActionDefinition[]` — eager (existing). Self-hosted backends
  keep using this through `allProviderActions`.
- `lazyXxxActions: LazyActionDefinition[]` — new. Each entry has an `id` and
  a `load()` thunk; the action's module is only imported on first
  `registry.loadAction(id)` / `registry.executeAction(id)` call.

Edge bundles register `allProviderActionsLazy` instead of
`allProviderActions`. Both can coexist — `register()` always wins over
`registerLazy()` for the same id.

For maximum cold-start savings each migrated provider also exports a
dedicated entry point that contains nothing but the lazy descriptors (no
static imports of the provider's action modules):

```ts
// Pulls only the descriptors — provider SDKs load on-demand via `import()`.
import { lazyGmailActions } from '@flowlib/actions/gmail/lazy';
import { lazyGithubActions } from '@flowlib/actions/github/lazy';

registry.registerLazy([...lazyGmailActions, ...lazyGithubActions]);
```

Importing from `@flowlib/actions` directly will pull both eager and lazy
exports through one chunk; bundlers with strict tree-shaking can still
drop the eager arrays, but the per-provider `*/lazy` subpaths guarantee
the smallest cold-start.

## Migrated (5)

| Provider | Module                           | Action count |
| -------- | -------------------------------- | ------------ |
| `core`   | `pkg/actions/src/core/lazy.ts`   | 9            |
| `http`   | `pkg/actions/src/http/lazy.ts`   | 1            |
| `github` | `pkg/actions/src/github/lazy.ts` | 20           |
| `gmail`  | `pkg/actions/src/gmail/lazy.ts`  | 5            |
| `slack`  | `pkg/actions/src/slack/lazy.ts`  | 2            |

## Pending (follow-up PRs)

The remaining providers all live under `pkg/actions/src/<provider>/` and
expose an eager `xxxActions` array. Migration is mechanical: add a sibling
`lazy.ts` exporting `lazyXxxActions: LazyActionDefinition[]` whose entries
match the action ids exported from `index.ts`.

- `asana`
- `cloudwatch`
- `dropbox`
- `facebook`
- `freshdesk`
- `gitlab`
- `google-analytics`
- `google-calendar`
- `google-docs`
- `google-drive`
- `google-sheets`
- `grafana`
- `hubspot`
- `intercom`
- `jira`
- `linear`
- `linkedin`
- `microsoft`
- `microsoft-teams`
- `mixpanel`
- `notion`
- `onedrive`
- `pagerduty`
- `postgres`
- `resend`
- `salesforce`
- `segment`
- `sendgrid`
- `sentry`
- `shopify`
- `stripe`
- `trello`
- `triggers`
- `twitter`
- `woocommerce`
- `zendesk`

Once all providers are migrated, `allProviderActionsLazy` will be a
drop-in replacement for `allProviderActions` for any consumer that doesn't
need eager iteration over the catalogue.
