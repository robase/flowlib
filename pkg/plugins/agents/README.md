# @flowlib/agents

Code-editing AI agents plugin for Flowlib.

> **Status: Phase 0 (foundation only).** This package currently ships
> contracts, types, and the database schema. Phase 1 streams will land
> the providers (Claude Code, opencode), workspaces (Cloudflare Sandbox),
> orchestration kernel, REST endpoints, the `AIChatAgent` Durable
> Object, and the frontend chat surface.

## Features (planned)

- **Multi-provider:** Claude Code (Anthropic SDK), opencode,
  raw-LLM. Provider SDKs are lazy-imported.
- **Sandboxed workspaces:** Cloudflare Sandbox SDK in v1; local-fs and
  git-clone modes pre-declared for the deferred Express deployment.
- **Tenant-scoped:** every row carries an `orgId`; DO names are
  prefixed `org:${orgId}/...` for structural isolation.
- **Flowlib actions as tools:** any registered Flowlib action becomes
  an MCP tool the agent can call (off by default per agent).
- **Hooks + permissions:** PreToolUse / PostToolUse pipeline for secret
  redaction, sensitive-path denies, role-derived deny lists.

## Install

```bash
pnpm add @flowlib/agents
# Plus your chosen provider/runtime SDKs:
pnpm add @anthropic-ai/claude-agent-sdk    # Claude Code
pnpm add @opencode-ai/sdk                  # opencode
pnpm add @cloudflare/sandbox agents        # Cloudflare deployment
```

## Configure

```ts
// flowlib.config.ts
import { defineConfig } from '@flowlib/core';
import { agents } from '@flowlib/agents';

export default defineConfig({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY!,
  plugins: [
    agents({
      // Optional. Defaults to 'default-org'. Used as the fallback when
      // identity.metadata.orgId is unset (single-tenant deployments).
      staticOrgId: 'acme',

      // 'optional' (default) — boots without an auth plugin.
      // 'required' — logs a warning if no auth plugin and no
      //              staticOrgId; still boots.
      orgScope: 'optional',
    }),
  ],
});
```

## Run migrations

```bash
npx flowlib-cli generate    # adds agent_* tables to the merged schema
npx flowlib-cli migrate
```

## Tests

The package uses [`@cloudflare/vitest-pool-workers`](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers)
so tests run inside a real `workerd` runtime — exactly the environment
the Cloudflare Durable Object code paths run in production.

```bash
pnpm --filter @flowlib/agents test       # one-shot
pnpm --filter @flowlib/agents test:watch # watch mode
```

The pool boots a fresh isolate per test file, so individual tests can
import `cloudflare:workers`, access durable-object stubs, and use
Workers-only globals (`crypto.subtle`, `caches`, `WebSocketPair`, ...)
without special setup. See [`vitest.config.ts`](./vitest.config.ts)
for the compatibility date and flags.

## Plan docs

See `plans/agents/` for the architecture, data model, sessions, and
phased implementation plan. The "Stream P0" section of
`plans/agents/implementation-plan.md` covers the contracts in this
package; later streams flesh them out.
