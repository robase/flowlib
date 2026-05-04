<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/logo-light.svg">
    <img alt="Flowlib" src="../../.github/assets/logo-dark.svg" width="50">
  </picture>
</p>

<h1 align="center">@flowlib/db</h1>

<p align="center">
  Drizzle schemas + schema tooling for Flowlib core.
  <br />
  <a href="https://flowlib.dev/docs"><strong>Docs</strong></a>
</p>

---

The database surface of Flowlib, split out so any JS runtime — Node, Cloudflare Workers, edge functions, third-party apps — can query Flowlib tables without dragging in the executor.

`@flowlib/core` depends on this package; you don't need both unless you're running the full execution engine.

## Install

```bash
npm install @flowlib/db drizzle-orm
```

## Usage

### Querying Flowlib tables in a Worker / edge runtime

The dialect subpaths (`/sqlite`, `/postgres`, `/mysql`) are tree-shakable and depend only on `@flowlib/action-kit`. Bundle cost is ~2 KB gzip per dialect.

```ts
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { flowTriggers } from '@flowlib/db/sqlite';

export default {
  async scheduled(_, env: { DB: D1Database }) {
    const db = drizzle(env.DB);
    const due = await db
      .select()
      .from(flowTriggers)
      .where(eq(flowTriggers.isEnabled, true));
    // …
  },
};
```

### Authoring a plugin schema

Plugins declare tables in an abstract, dialect-agnostic format. The Flowlib CLI (`npx flowlib-cli generate`) merges core + plugin schemas and emits the dialect-specific Drizzle files.

```ts
import type { FlowlibPluginSchema } from '@flowlib/db';

export const MY_PLUGIN_SCHEMA: FlowlibPluginSchema = {
  audit_logs: {
    fields: {
      id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
      action: { type: 'string', required: true },
      userId: { type: 'string', references: { table: 'flows', field: 'id' } },
      metadata: { type: 'json' },
      createdAt: { type: 'date', defaultValue: 'now()' },
    },
  },
  // Extend an existing core table (additive only)
  flows: {
    fields: {
      tenantId: { type: 'string', index: true },
    },
  },
};
```

### Generating Drizzle source from a merged schema

The merger and generators are useful if you're building tooling that compiles plugin schemas into migration files. The CLI uses these internally.

```ts
import { mergeSchemas, generateSqliteSchema } from '@flowlib/db';

const merged = mergeSchemas([myPlugin]);
const sqliteSource = generateSqliteSchema(merged);
```

## What's Inside

- **Dialect schemas** (`/sqlite`, `/postgres`, `/mysql`) — Drizzle table definitions for every Flowlib core table (flows, flow_versions, flow_runs, action_traces, batch_jobs, credentials, flow_triggers, chat_messages).
- **Core abstract schema** (`CORE_SCHEMA`, `CORE_TABLE_NAMES`, `CORE_ENUMS`) — the dialect-agnostic source-of-truth used by the merger.
- **Schema merger** (`mergeSchemas`, `diffSchemas`) — combines core + plugin schemas, validates conflicts, supports cross-cutting `SchemaTransform`s (e.g., a multi-tenant variant injecting `organization_id` everywhere).
- **Drizzle generators** (`generateSqliteSchema`, `generatePostgresSchema`, `generateMysqlSchema`, plus `…Append` and `…RawSql` variants) — emit dialect-specific TypeScript or raw DDL from a merged schema.
- **Prisma generator** (`generateFullPrismaSchema`, `generatePrismaModels`) — emits a Prisma `schema.prisma` instead of Drizzle.
- **Plugin schema types** (`FlowlibPluginSchema`, `PluginFieldType`, `PluginFieldAttribute`, `PluginTableDefinition`) — the abstract format plugins declare.

## Subpath Exports

| Path | Contents | Bundle (gzip) |
|---|---|---|
| `@flowlib/db` | Merger + generators + plugin schema types + dialect namespace re-exports | ~11 KB |
| `@flowlib/db/sqlite` | SQLite Drizzle tables | ~1.9 KB |
| `@flowlib/db/postgres` | Postgres Drizzle tables | ~2.2 KB |
| `@flowlib/db/mysql` | MySQL Drizzle tables | ~2.1 KB |

The dialect subpaths have **no `@flowlib/core` dependency**, only `drizzle-orm` and `@flowlib/action-kit` (types-only enums).

## Why a separate package

`@flowlib/core` includes the action registry, AI provider adapters (OpenAI / Anthropic / OpenRouter), QuickJS, and the full execution engine — ~9 MB raw. Importing a Drizzle table object should not require loading any of that. Splitting the schemas + tooling out lets Worker-style consumers (Cloudflare D1, Vercel Edge, etc.) take what they need at a fraction of the bundle cost.

See [`plans/db-package-split-plan.md`](../../plans/db-package-split-plan.md) for the full design rationale.

## License

[MIT](../../LICENSE)
