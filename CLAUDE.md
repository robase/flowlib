# Flowlib — AI Coding Agent Instructions

## Project Overview

Flowlib is a workflow orchestration system with visual flow editor, AI agents, and batch processing via OpenAI/Anthropic APIs. **pnpm monorepo** with a framework-agnostic core (`pkg/core`) plus framework adapters (`pkg/nestjs`, `pkg/express`, `pkg/nextjs`, `pkg/ui`) and a lightweight executor (`pkg/primitives`) for running flows in any JS runtime without a database.

The git repo is named `flow-backend` but all packages publish under `@flowlib/*`. Database: Drizzle ORM (SQLite, PostgreSQL, MySQL).

## Monorepo Structure (pnpm Workspaces)

`pnpm-workspace.yaml`:

```yaml
packages:
  - pkg/* # Publishable packages
  - pkg/plugins/* # Plugin packages (nested one level deeper)
  - examples/* # Development/demo apps
  - docs # Documentation site (Fumadocs + Next.js)
```

### `pkg/` — Publishable packages (npm, published as `@flowlib/*`)

```
pkg/
├── core/           # Framework-agnostic logic (services, schemas, createFlowlib factory)
├── action-kit/     # Types-only package — action/tool/node type contracts
├── actions/        # Built-in provider actions (Gmail, Slack, GitHub, 40+ providers)
├── primitives/     # Lightweight DB-less flow executor (runs flows in any JS runtime)
├── nestjs/         # NestJS adapter (controllers, modules)
├── express/        # Express adapter (routes)
├── nextjs/         # Next.js adapter (catch-all API route handlers)
├── ui/             # React components (React Router v7, flow editor, FlowlibShell, Flowlib)
├── layouts/        # Layout components
├── cli/            # CLI (npx flowlib-cli) — init, generate, migrate, info, secret, mcp
├── flowlib/         # Published CLI wrapper (thin shim: `flowlib-cli` bin → @flowlib/cli)
└── plugins/        # Official plugins
    ├── auth/              # @flowlib/user-auth — Better Auth integration
    ├── rbac/              # @flowlib/rbac — Role-Based Access Control
    ├── webhooks/          # @flowlib/webhooks — Webhook triggers + management
    ├── version-control/   # @flowlib/version-control — Git sync (GitHub/GitLab/Bitbucket)
    ├── cloudflare-agents/ # @flowlib/cloudflare-agents — Compile flows to Cloudflare Workers/Workflows
    ├── vercel-workflows/  # @flowlib/vercel-workflows — Compile flows to Vercel Workflows
    └── mcp/               # @flowlib/mcp — Expose flows as MCP tools (Claude Desktop, Copilot)
```

**Important layering** (post-refactor — older docs may not reflect this):

- `@flowlib/action-kit` is **types-only**. It defines `ActionDefinition`, `ActionExecutionContext`, `AgentToolDefinition`, node/flow/AI types, and the `defineAction()` helper. Both `@flowlib/core` and `@flowlib/actions` consume it without pulling each other's runtime code.
- `@flowlib/actions` is the **action catalogue**. Every integration action (Gmail, Slack, GitHub, Linear, etc.) plus the primitive-runtime bundles (`core`, `http`, `triggers`) live here. Exported via per-provider subpaths (`@flowlib/actions/gmail`, `@flowlib/actions/slack`, …) and bulk `allProviderActions`.
- `@flowlib/core` re-exports action infrastructure for backward compatibility. `pkg/core/src/actions/` is a thin barrel/bridge — the action **implementations** live in `@flowlib/actions`, and `pkg/core/src/actions/` only holds: `action-registry.ts`, `action-executor.ts` (the node↔action and tool↔action bridges), `types.ts`, `providers.ts`, `define-action.ts`, and `index.ts`.
- `@flowlib/primitives` is a **DB-less, framework-less flow runner**. It reuses `@flowlib/actions` plus fork variants of a few actions (if-else, switch, javascript, output) that avoid QuickJS so flows can run in Cloudflare Workers, Vercel Workflows, edge runtimes, etc.

### `examples/` — Dev/Demo apps (not published)

Use `workspace:*` to link local packages. Run: `pnpm dev` (interactive menu).

```
examples/
├── express-drizzle/            # Primary backend dev server (Express + Drizzle + SQLite)
├── vite-react-frontend/        # Primary frontend dev server (Vite + React)
├── nest-prisma/                # NestJS + Prisma (Jest, not Vitest)
├── nextjs-app-router/          # Self-contained Next.js 15 example
└── nextjs-drizzle-auth-rbac/   # Next.js + Postgres + auth + rbac plugins (full-featured)
```

#### Example project details

| Example                    | Framework    | Database                    | Adapter                         | Purpose                                                                                                                                                                                                                     |
| -------------------------- | ------------ | --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `express-drizzle`          | Express      | SQLite (`./dev.db`)         | `@flowlib/express`               | Primary backend dev server. Paired with `vite-react-frontend` for fullstack dev. Uses `nodemon` for hot-reload. Depends on most plugins (auth, rbac, webhooks, mcp, vercel-workflows, version-control) for breadth testing. |
| `vite-react-frontend`      | Vite + React | N/A (frontend only)         | `@flowlib/ui`                    | Standalone React frontend. Connects to Express backend on port 3000. Dev server on port 5173.                                                                                                                               |
| `nest-prisma`              | NestJS       | SQLite (`./prisma/dev.db`)  | `@flowlib/nestjs`                | NestJS adapter example. Uses Prisma ORM (not Drizzle). Jest test framework.                                                                                                                                                 |
| `nextjs-app-router`        | Next.js 15   | SQLite (internal)           | `@flowlib/nextjs` + `@flowlib/ui` | Mounts Flowlib UI at `/flowlib` route.                                                                                                                                                                                        |
| `nextjs-drizzle-auth-rbac` | Next.js 15   | PostgreSQL (Docker Compose) | `@flowlib/nextjs` + `@flowlib/ui` | Full-featured with `@flowlib/user-auth` + `@flowlib/rbac`. Uses `pg` + Drizzle.                                                                                                                                               |

The **primary development workflow** is `express-drizzle` + `vite-react-frontend` together (`pnpm dev:fullstack`). The Next.js examples are self-contained alternatives.

### Workspace dependency flow

```
examples/express-drizzle/package.json:
  @flowlib/core: "workspace:*"      → links to pkg/core
  @flowlib/express: "workspace:*"   → links to pkg/express
  @flowlib/user-auth: "workspace:*" → links to pkg/plugins/auth
  ...

When you edit pkg/core/src/services/flows.service.ts:
  1. tsdown rebuilds → pkg/core/dist/*
  2. pnpm workspace updates symlinks automatically
  3. nodemon in examples/express-drizzle detects change in pkg/core/dist
  4. Express server auto-restarts with new code
```

## Critical Workflows

### Development

- `pnpm dev` — Interactive menu (start here)
- `pnpm dev:fullstack` — Express + Vite together (primary)
- `pnpm dev:express-example` / `pnpm dev:vite-example` / `pnpm dev:next` / `pnpm dev:nest`
- `pnpm dev:packages` / `pnpm dev:all` — Run watch mode for all `@flowlib/*` packages
- Hot-reload: edit `pkg/core/src/*` → tsdown rebuilds → workspace symlinks update → server restarts

### Database (plugin schema system)

- `npx flowlib-cli generate` → `npx flowlib-cli migrate` (merges core + plugin schemas automatically)
- Core schema is defined in abstract form in `pkg/core/src/database/core-schema.ts`
- The CLI produces dialect-specific Drizzle files for SQLite, PostgreSQL, and MySQL from the merged schema
- Plugins declare their own tables and extend core tables via `plugin.schema`
- Example apps consume the generated Drizzle files locally (`examples/express-drizzle/db/schema.ts`)

### Agent regression guardrails

- Before changing workspace package imports/exports, verify three layers stay aligned: package `exports`, emitted `dist` files, and example app direct dependencies. Workspace symlinks do not guarantee examples resolve transitive subpaths like `@flowlib/core/types`.
- When changing plugin schemas or plugin-owned persistence, update real consumer surfaces together: the example app schema flow, isolated test servers under `playwright/tests/platform/`, and startup table checks. A plugin table that exists only in one place will regress builds or local dev.
- Be careful with watch-mode builds for packages consumed from `dist/`. Cleaning `dist/` during rebuilds can trigger transient `ERR_MODULE_NOT_FOUND` crashes in example apps watching those folders.
- Do not trust stale terminal output after package or lockfile changes. Re-run the smallest targeted build/test that exercises the changed package graph before concluding a regression still exists.

### Testing & type checking

- `pnpm test` — Core unit + CLI + auth + version-control tests
- `pnpm test:int` — Core integration tests
- `pnpm test:all` — All tests across all packages
- `pnpm test:e2e` — Programmatic E2E in `pkg/core/tests/e2e/` (requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for AI tests)
- `pnpm test:pw` — Playwright tests (api, frontend, e2e, critical-paths projects; auto port-check)
- `pnpm test:pw:force-kill` — Same as `test:pw` but kills processes on required ports first
- `pnpm test:pw:ui` / `pnpm test:pw:headed`
- `pnpm typecheck` — `tsc --noEmit` across all workspace packages
- `pnpm format` / `pnpm format:check` — `oxfmt`
- `pnpm lint` / `pnpm lint:check` — `oxlint`
- `pnpm ux:audit` — Playwright screenshot capture + analysis (`ux:capture` + `ux:analyze`)
- `pnpm setup:credentials` — `scripts/setup-credentials.sh` bootstrap
- `cd pkg/cli && pnpm test` — CLI schema-generation + migration tests

## Flowlib Core Integration Pattern

The entry point is the `createFlowlib()` async factory in `pkg/core/src/api/create-flowlib.ts`. It returns an `FlowlibInstance` with **11 namespaced sub-APIs**. Framework packages (`pkg/express`, `pkg/nestjs`, `pkg/nextjs`) are thin adapters that wrap this instance.

> **Legacy**: The `Flowlib` class in `pkg/core/src/flowlib-core.ts` still exists (flat methods like `flowlib.createFlow()`) but all framework adapters now use the modern factory. New code must always use `createFlowlib()`.

### Architecture: core → framework adapters

```
┌─────────────────────────────────────────────┐
│           @flowlib/core                      │
│  createFlowlib(config) → FlowlibInstance      │
│    .flows     (CRUD + rendering)            │
│    .versions  (version management)          │
│    .runs      (execution + streaming)       │
│    .credentials (storage + OAuth2)          │
│    .triggers  (cron + webhooks)             │
│    .agent     (tools + prompts)             │
│    .chat      (streaming + history)         │
│    .actions   (registry + providers)        │
│    .testing   (node/expression tests)       │
│    .auth      (permissions + roles)         │
│    .plugins   (management + hooks)          │
└─────────┬──────────┬──────────┬─────────────┘
          │          │          │
      Express    NestJS      Next.js
      Router     Module      Handler
```

### `FlowlibInstance` sub-APIs

```typescript
interface FlowlibInstance {
  readonly flows: FlowsAPI;
  readonly versions: FlowVersionsAPI;
  readonly runs: FlowRunsAPI;
  readonly credentials: CredentialsAPI;
  readonly triggers: TriggersAPI;
  readonly agent: AgentAPI;
  readonly chat: ChatAPI;
  readonly actions: ActionsAPI;
  readonly testing: TestingAPI;
  readonly auth: AuthAPI;
  readonly plugins: PluginsAPI;

  // Root-level utilities
  getLogger(scope: string, context?: string): ScopedLogger;
  getLoggerManager(): LoggerManager;
  setLogLevel(scope: string, level: LogLevel): void;

  // Lifecycle
  shutdown(): Promise<void>;
  startBatchPolling(): Promise<void>;
  stopBatchPolling(): Promise<void>;
  startMaintenancePolling(): Promise<void>;
  stopMaintenancePolling(): Promise<void>;
  startCronScheduler(): Promise<void>;
  stopCronScheduler(): void;
  refreshCronScheduler(): Promise<void>;
  runMaintenance(options?: FlowlibMaintenanceOptions): Promise<FlowlibMaintenanceResult>;
  healthCheck(): Promise<Record<string, boolean>>;
}
```

### Framework integration (summary)

- **Express** (`pkg/express`): `createFlowlibRouter(config)` async factory — calls `createFlowlib()`, starts batch polling + cron scheduler, returns Express Router. Routes are thin wrappers around `flowlib.<namespace>.<method>()`.
- **NestJS** (`pkg/nestjs`): `FlowlibModule.forRoot(config)` / `.forRootAsync({ useFactory, inject })` — injects a single `FlowlibInstance` via DI token `'FLOWLIB_CORE'`. Controller delegates to service → namespaced API.
- **Next.js** (`pkg/nextjs`): `createFlowlibHandler(config)` factory returns `{ GET, POST, PATCH, PUT, DELETE }` for catch-all routes (`app/api/flowlib/[...flowlib]/route.ts`). Core instance is internal singleton.

**New framework adapter**: create `pkg/<framework>/`, import `createFlowlib`, wrap routes → `flowlib.<namespace>.<method>()`.

## Core Architecture Concepts

### 1. Service layer pattern

All business logic flows through services in `pkg/core/src/services/`:

```
FlowOrchestrationService            # Orchestrates complete flow execution
├── FlowRunCoordinator              # Full flow-run lifecycle
├── NodeExecutionCoordinator        # Per-node execution + template resolution
├── FlowsService / FlowVersionsService / FlowRunsService / NodeExecutionService
├── BatchJobsService                # Batch processing integration
└── CredentialsService              # Secure credential storage

NodeDataService                     # Cross-cutting (SQL, JQ, AI)
GraphService                        # Topological sort, dependency analysis
TemplateService                     # Template rendering (JS expressions via QuickJS WASM)
JsExpressionService                 # QuickJS sandbox
ReactFlowRendererService            # Flow visualization data for frontend
ExecutionEventBus                   # Execution lifecycle events
FlowValidator                       # Flow definition validation
AuthorizationService                # Authorization + plugin auth hooks
ChatService                         # Chat streaming + message history
TriggersService                     # Cron/webhook trigger management
AgentToolExecutionsService          # Agent tool execution tracking
```

**Never bypass services** — don't access database models directly from controllers/executors.

### 2. Provider-Actions architecture (primary)

Every node type is defined as an action using `defineAction()`. An action is a single-file definition that serves as **both** a flow node and an agent tool — including the AI agent itself, which lives at `pkg/actions/src/core/agent.ts` under the action id `core.agent`.

Node types are **string-based action IDs** (e.g., `"core.jq"`, `"gmail.send_message"`, `"core.agent"`). Actions are grouped by **provider** (core, http, gmail, slack, github, google-drive, …).

```typescript
// pkg/actions/src/core/javascript.ts (or similar)
import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod';

export const javascriptAction = defineAction({
  id: 'core.javascript', // Node type string used in flow definitions
  name: 'JavaScript',
  description: 'Run a JavaScript expression',
  provider: CORE_PROVIDER,

  params: {
    schema: z.object({ code: z.string() }),
    fields: [{ name: 'code', label: 'JavaScript', type: 'code', required: true }],
  },

  async execute(params, context) {
    // params: Zod-validated and template-resolved
    // context: logger, credential, incomingData, functions (submitPrompt, getCredential, …)
    return { success: true, output: result };
  },
});
```

**Action directory structure** (lives in `@flowlib/actions`, not core):

```
pkg/actions/src/
├── providers.ts                 # Provider definitions (CORE_PROVIDER, GMAIL_PROVIDER, …)
├── registry/                    # ActionRegistry implementation
├── action-executor.ts           # executeActionAsNode / executeActionAsTool / createToolExecutorForAction
├── index.ts                     # Barrel exports + allProviderActions
├── core/                        # core.input, core.output, core.model, core.javascript, core.if_else, core.switch, core.template_string
├── http/                        # http.request
├── gmail/                       # gmail.list_messages, gmail.send_message, gmail.create_draft, gmail.get_message, gmail.modify_labels
├── slack/  github/  google-drive/  google-docs/  google-sheets/  google-calendar/  google-analytics/
├── linear/  microsoft/  microsoft-teams/  postgres/  triggers/
└── ~40 more providers (asana, cloudwatch, dropbox, facebook, freshdesk, gitlab, grafana,
    hubspot, intercom, jira, linkedin, mixpanel, notion, onedrive, pagerduty, resend,
    salesforce, segment, sendgrid, sentry, shopify, stripe, trello, twitter,
    woocommerce, zendesk, …)
```

**Re-exported from `@flowlib/core/actions`** for backward compatibility — `pkg/core/src/actions/index.ts` re-exports providers, registry, executor bridges, and `allBuiltinActions` (`= [...allProviderActions]`). **New code should import directly from `@flowlib/actions` or `@flowlib/action-kit`**; `@flowlib/core/actions` exists to avoid breaking existing example apps.

**Key characteristics**:

- One file = one action. Self-contained definition + execution.
- Every action auto-registers as both a flow node AND an agent tool.
- `ActionExecutionContext` provides: `logger`, `credential`, `incomingData`, `flowInputs`, `functions` (submitPrompt, getCredential, markDownstreamNodesAsSkipped, …), `flowRunState`.
- `ActionResult` may include `outputVariables` for multi-output nodes like if-else/switch (with `true_output`/`false_output`/`case_*` handles).

### 3. Workflow execution model

#### Input data construction

When a node executes (or when viewing its config panel), its **input data** is a JSON object built from upstream node outputs:

- **Keys**: upstream node's `referenceId` (or label normalized to `snake_case`)
- **Values**: each upstream node's output (JSON-parsed if valid, otherwise raw string)
- **Collision handling**: if two nodes produce the same key, incrementing numbers are appended (`some_a`, `some_a1`)

```json
{
  "fetch_user": { "id": 123, "name": "Alice" },
  "get_config": "production"
}
```

#### Config param resolution

Config params resolve as either:

1. **Literal values** — used as-is
2. **JavaScript template expressions** — resolved against the input data object via QuickJS WASM sandbox

```typescript
// If input data is { "fetch_user": { "id": 123 } }
// A config param "User ID: {{ fetch_user.id }}" resolves to "User ID: 123"
// Supports full JS: {{ users.filter(u => u.active).length }}
```

**Key services**: `TemplateService` (rendering via QuickJS), `NodeExecutionCoordinator.buildIncomingDataObject()` (input construction), `NodeExecutionCoordinator.resolveTemplateParams()` (param resolution).

#### Execution flow

```
executeFlow(flowId, inputs)
  ├── FlowsService.getFlowById()
  ├── FlowOrchestrationService.initiateFlowRun()
  │   ├── FlowRunsService.createFlowRun()
  │   ├── GraphService.topologicalSort()
  │   ├── For each node in order:
  │   │   ├── buildIncomingDataObject()
  │   │   ├── resolveTemplateParams()
  │   │   ├── executeNode()
  │   │   │   ├── NodeExecutionService.createNodeExecution()
  │   │   │   ├── action registry → executeActionAsNode()
  │   │   │   └── NodeExecutionService.updateNodeExecutionStatus()
  │   │   └── Store output for downstream nodes
  │   └── markExecutionSuccess / Failed()
  └── Return FlowRunResult
```

#### Flow control nodes

If-else, switch, and similar nodes are **passthrough** — their output equals their input. Downstream nodes on the active branch (`true_output`, `false_output`, `case_*`) receive the flow-control node's input data unchanged.

**Batch processing**: When a node returns `state: "PENDING"`, the flow pauses (`PAUSED_FOR_BATCH`). Maintenance polling resumes it when the batch completes.

### 4. Database layer abstraction

```typescript
// Models handle CRUD across all database types
class FlowsModel {
  constructor(
    private db: DatabaseConnection,
    private dbType: DatabaseType,
  ) {}

  async create(data: NewFlow): Promise<Flow> {
    return this.db.insert(flows).values(data).returning();
  }
}

// Services use models
class FlowsService {
  constructor(private databaseService: DatabaseService) {}

  async createFlow(input: CreateFlowInput): Promise<Flow> {
    return this.databaseService.flows.create(input);
  }
}
```

**Never write raw SQL** — use Drizzle ORM methods.

## Project-Specific Conventions

### Import paths

```typescript
// CORRECT — path aliases from tsconfig (core development)
import { FlowsService } from 'src/services/flows/flows.service';
import { Logger } from 'src/schemas';
import type { FlowlibDefinition } from 'src/services/flow-versions/schemas-fresh';

// CORRECT — cross-package
import type { ActionDefinition } from '@flowlib/action-kit';
import { allProviderActions } from '@flowlib/actions';

// WRONG — avoid long relative paths
import { FlowsService } from '../../services/flows/flows.service';
```

### Frontend/backend type separation (CRITICAL)

The `@flowlib/core` package has multiple entry points:

- `@flowlib/core` — Main entry; Node.js-specific runtime code (executors, services)
- `@flowlib/core/types` — Types-only entry for frontend consumption (via `types.frontend.ts`)
- `@flowlib/core/sdk` — Declarative TypeScript flow builder (`defineFlow`, node helpers, provider namespaces)
- `@flowlib/core/drizzle/sqlite`, `/postgres`, `/mysql` — Dialect-specific Drizzle schemas

**`types.frontend.ts` MUST NOT import runtime code.** Otherwise the frontend build fails with:

```
"createRequire" is not exported by "__vite-browser-external"
```

**Rules for `pkg/core/src/types.frontend.ts`:**

1. Use `import type` for imports from service/node files
2. Never import Zod schemas with runtime code (use types only)
3. Never import from barrel files like `./nodes` or `./services` that re-export runtime code
4. Only export pure TypeScript types, enums, and type-only re-exports

**Rules for `pkg/core/src/types.internal.ts`:**

1. Same rules (it's imported by `types.frontend.ts`)
2. Use `import type` for imports from `./services/*`
3. Zod schemas defined here are OK (needed for runtime validation)
4. But imports **from** other files must be type-only

```typescript
// CORRECT
import type { FlowEdge } from './services/flow-versions/schemas-fresh';
import type { BatchProvider } from './services/ai/ai-types';
export type { NodeExecutionResult } from './types/node-execution.types';

// WRONG — pulls in runtime code
import { FlowEdge } from './services/flow-versions/schemas-fresh';
import { NodeExecutionResult } from './nodes'; // barrel has executors
export { loopConfigSchema } from './services/flow-versions/schemas-fresh'; // Zod = runtime
```

**If the frontend build fails with Node.js module errors:**

1. Check `pkg/core/dist/types.frontend.js` for `rolldown_runtime` imports
2. Trace which import pulls in runtime code
3. Change to `import type` or move the type into a pure types file

### Type safety for node I/O

```typescript
// Node outputs stored via StructuredOutput
type NodeOutputs = {
  nodeType: string; // Action ID ("core.javascript", "gmail.send_message", "core.agent", …)
  data: {
    variables: Record<string, { value: unknown; type: 'string' | 'object' }>;
    metadata?: Record<string, unknown>;
  };
};

// Input data for downstream nodes (built by buildIncomingDataObject)
type NodeIncomingDataObject = Record<string, unknown>;
// Example: { "fetch_user": { id: 123 }, "api_result": "success" }
```

**Flow node definitions** use string-based types:

```typescript
{
  id: "my-node",
  type: "core.javascript",   // Action ID string
  label: "Transform Data",
  referenceId: "data",
  params: { code: "return inputs.user.name" },
  position: { x: 100, y: 200 },
}
```

**Template access**: Use `{{ upstream_node_slug }}` or `{{ upstream_node_slug.property }}` in JavaScript template expressions. Full JS is supported: `{{ items.filter(i => i.active) }}`.

### Error handling & logging

```typescript
import { ValidationError, DatabaseError } from 'src/types/common/errors.types';

throw new ValidationError('Flow definition invalid', { flowId });
throw new DatabaseError('Failed to create flow', { error });

this.logger.info('Flow execution started', { flowId, flowRunId });
this.logger.debug('Node inputs prepared', { nodeId, inputKeys: Object.keys(inputs) });
this.logger.error('Node execution failed', { nodeId, error: error.message });
```

## Integration & security

- **NestJS**: `FlowlibModule.forRoot(config)` — `config` is an `FlowlibConfig` (`{ database, encryptionKey, plugins?, ... }`)
- **Frontend**: `<Flowlib config={...} />` — same config shape; only `apiPath`, `frontendPath`, `theme`, `plugins` are read client-side (the rest passes through harmlessly)
- **Credentials**: AES-256-GCM encrypted. Set `FLOWLIB_ENCRYPTION_KEY` (base64, 32 bytes — use `npx flowlib-cli secret`). Access in actions: `context.credential` (auto-refreshed for OAuth2) or `context.functions.getCredential(id)`

## Authoring SDK (`@flowlib/sdk`)

`@flowlib/sdk` is the unified TypeScript flow-authoring surface — used in hand-authored `.flow.ts` files, the chat assistant's source-level edits, copy-paste round-trip, and git sync. It is type-safe end-to-end.

### Named-record `defineFlow` (preferred form)

Keys are referenceIds; edges narrow `from`/`to`/`handle` against them.

```ts
import { defineFlow, input, output, ifElse, switchNode } from '@flowlib/sdk';
import { gmail, slack } from '@flowlib/sdk/actions';

export default defineFlow({
  name: 'Triage event',
  nodes: {
    event: input(),
    classify: ifElse({ condition: '{{ event.priority > 5 }}' }),
    notify: gmail.sendMessage({
      credentialId: '{{ env.GMAIL }}',
      to: 'oncall@example.com',
      subject: 'Alert',
      body: '{{ event.message }}',
    }),
    log: output({ value: 'logged' }),
  },
  edges: [
    { from: 'event', to: 'classify' },
    { from: 'classify', to: 'notify', handle: 'true_output' }, // ✓
    { from: 'classify', to: 'log', handle: 'false_output' }, // ✓
    // { from: 'classify', to: 'log',    handle: 'output' }      // ✗ tsc: not assignable to '"true_output" | "false_output"'
    // { from: 'evnt',     to: 'notify' }                        // ✗ tsc: '"evnt"' not in '"event" | "classify" | "notify" | "log"'
    // { from: 'event',    to: 'event' }                         // ✗ tsc: self-loop blocked by Exclude in EdgeOf<N>
  ],
});
```

The legacy **array form** (`nodes: [helper('ref', ...)]`) still type-checks and runs; defineFlow is overloaded to accept both. Only use the array form for non-string referenceIds or programmatic construction.

### Type-safety guarantees

- **Action params** are split into Zod `input` (caller-facing — defaults are optional) and `output` (`execute()` runtime) shapes. Authors pass the input shape, runtime parses to output. Missing required fields, wrong types, and out-of-enum values fire as `tsc` errors at the call site.
- **Edge handles** narrow against the source action's declared output union. `core.if_else` → `'true_output' | 'false_output'`; `core.switch` computes the union from `cases[].slug` literals (`{ slug: 'high', ... } as const` propagates without manual annotation thanks to the `const C` modifier on the helper).
- **Edge `from`/`to`** narrow against `keyof N` in the named-record form. Self-loops are blocked.
- See [pkg/action-kit/src/define-action.ts](pkg/action-kit/src/define-action.ts) for the `defineAction<S, const H>` machinery — `z.input<S>` / `z.output<S>` drive both sides.

### Codegen-generated action wrappers (`@flowlib/sdk/actions`)

Every action in `@flowlib/actions` ships with a typed wrapper under `@flowlib/sdk/actions`:

```ts
import { gmail, github, linear, slack } from '@flowlib/sdk/actions';

gmail.sendMessage({ credentialId, to, subject, body });
linear.createIssue({ credentialId, teamId, title });
```

- Each wrapper has a `*Params` interface (e.g. `GmailSendMessageParams`) with **per-field JSDoc** lifted from `params.fields[].description`. Hover any field at a call site and IntelliSense surfaces the field's UI-form description.
- Field types reference `z.input<typeof <action>.params.schema>['<field>']` directly — there's no risk of drift from the underlying schema.
- The catalogue lives at [pkg/sdk/src/generated/](pkg/sdk/src/generated/) and is committed. Regenerate with `pnpm --filter @flowlib/sdk gen-actions`. CI runs `gen-actions:check` to fail on diff.
- Core actions (`core.input`, `core.output`, `core.javascript`, `core.if_else`, `core.switch`, `core.agent`, `http.request`, `trigger.*`) are NOT codegened — they have hand-written wrappers in [pkg/sdk/src/nodes/core.ts](pkg/sdk/src/nodes/core.ts) that carry handle-narrowing and accept arrow forms (`code: (ctx) => ...`).

### Pre-save TypeScript validation (chat assistant)

The chat assistant's `write_flow_source` and `edit_flow_source` tools run the LLM-generated source through the real TS compiler **before** save. Wrong handles, missing fields, unknown referenceIds — anything `tsc --strict` would flag — gets surfaced back to the LLM as line-numbered diagnostics, blocking the save until the LLM fixes it.

Implementation: [pkg/sdk/src/evaluator/typecheck.ts](pkg/sdk/src/evaluator/typecheck.ts) exports `typecheckSdkSource(source)`. It synthesises a temp file, builds a `ts.createProgram` with workspace package paths resolved via `package.json` `exports`, runs `getPreEmitDiagnostics`, and filters down to the user file. Cold-path latency is ~200ms (TS program creation). Called from [pkg/core/src/services/chat/tools/sdk-tools.ts](pkg/core/src/services/chat/tools/sdk-tools.ts) `saveFlowFromSource`.

### Emitter symmetry

The DB → source emitter ([pkg/sdk/src/emitter/index.ts](pkg/sdk/src/emitter/index.ts)) produces named-record form. Authoring named → save → re-load shows named on round-trip. The `parseSDKText` browser parser ([pkg/sdk/src/parse-fragment.ts](pkg/sdk/src/parse-fragment.ts)) accepts both forms (named-record and legacy array) so old emitter output keeps parsing.

### Author tooling — key files

- [pkg/sdk/src/define-flow.ts](pkg/sdk/src/define-flow.ts) — `defineFlow` overloads + `EdgeOf<N>`, `SdkFlowDefinitionNamed<N>`.
- [pkg/sdk/src/types.ts](pkg/sdk/src/types.ts) — public types (`SdkFlowNode<R, T, H>`, `EdgeOf<N>`, `HandlesOf<T>`).
- [pkg/sdk/src/nodes/core.ts](pkg/sdk/src/nodes/core.ts) — hand-written core helpers with handle-narrowing.
- [pkg/sdk/src/generated/](pkg/sdk/src/generated/) — codegen output (per-provider files + index barrel).
- [pkg/sdk/scripts/gen-actions.mjs](pkg/sdk/scripts/gen-actions.mjs) — codegen script.
- [pkg/sdk/src/evaluator/typecheck.ts](pkg/sdk/src/evaluator/typecheck.ts) — pre-save validation.

## AI Agent & Tool Calling Architecture

Flowlib supports AI agent workflows with tool calling via the `core.agent` action. Agents run a prompt→tool→iterate loop using OpenAI, Anthropic, or OpenRouter.

### Agent node overview

The agent action lives at `pkg/actions/src/core/agent.ts`. Its `execute()` runs the loop:

1. Send task prompt + available tools to the LLM
2. LLM responds with text or tool call(s)
3. Execute requested tools, return results to the LLM
4. Repeat until stop condition (explicit stop, max iterations, or first tool result)

```typescript
{
  credentialId: string,      // OpenAI/Anthropic credential
  model: string,             // e.g., "gpt-4o-mini", "claude-sonnet-4-0"
  taskPrompt: string,        // Supports JS template expressions
  systemPrompt?: string,
  enabledTools: string[],    // Tool IDs to enable
  maxIterations: number,     // 1–50, default 10
  stopCondition: "explicit_stop" | "tool_result" | "max_iterations",
  enableParallelTools: boolean,
}
```

### Tool sources

Tools live in `AgentToolRegistry` (`pkg/core/src/services/agent-tools/agent-tool-registry.ts`). Three sources:

1. **Action-based tools (primary)** — every `defineAction()` registration is automatically converted to an `AgentToolDefinition` during `createFlowlib()` init. `registerActionsAsTools()` iterates `ActionRegistry`, uses `toAgentToolDefinition()`, and registers with `createToolExecutorForAction()`. All Gmail/Slack/GitHub/Drive/etc. actions become agent tools for free.
2. **Standalone tools** — in `pkg/core/src/services/agent-tools/builtin/` (currently only `math_eval`; `json_logic` file exists but is not registered).
3. **Legacy node-based tools (deprecated)** — `AgentToolCapable` interface on old executor classes (JqNodeExecutor, HttpRequestNodeExecutor) still exists, but those executors are **no longer registered**. Effectively dead.

### Tool definition schema

```typescript
interface AgentToolDefinition {
  id: string; // Unique, snake_case
  name: string;
  description: string; // For LLM tool selection
  inputSchema: Record<string, unknown>; // JSON Schema
  category: 'data' | 'web' | 'code' | 'utility' | 'custom';
  tags?: string[];
  enabledByDefault?: boolean;
  timeoutMs?: number;
  nodeType?: string; // If backed by a node/action
  provider?: { id: string; name: string; icon: string };
}
```

### LLM provider adapters

In `pkg/core/src/services/ai/`:

- `OpenAIAdapter.executeAgentPrompt()` — OpenAI function calling
- `AnthropicAdapter.executeAgentPrompt()` — Anthropic tool_use (streaming)
- `OpenRouterAdapter.executeAgentPrompt()` — Extends OpenAI adapter; routes to multiple providers

All implement `convertTools(AgentToolDefinition[])` for provider-format translation.

### Frontend tool management

- `AgentNode.tsx` — agent node card with attached-tools box
- `ToolSelectorModal.tsx` — browse/select/configure tools
- `AgentToolsBox.tsx` — visual enabled-tools display
- `pkg/ui/src/api/agent-tools.api.ts` — `useAgentTools()` hook fetches `/agent/tools`

Tool instances support per-instance customization (custom name, description, params).

### Adding a new agent tool

**Option A (preferred): create a new action** — also becomes a flow node.

1. Create `pkg/actions/src/<provider>/<action-name>.ts` using `defineAction()` from `@flowlib/action-kit`
2. Export from the provider's `index.ts` barrel
3. Add to the provider's bundle (`<providerName>Actions`) — already included in `allProviderActions`
4. Auto-registers as flow node AND agent tool during `createFlowlib()` init

**Option B: standalone tool** (utility only, no flow node)

1. Create `pkg/core/src/services/agent-tools/builtin/<tool-name>.ts`
2. Export `<toolName>Definition: AgentToolDefinition` and `<toolName>Executor: AgentToolExecutor`
3. Register in `pkg/core/src/services/agent-tools/builtin/index.ts`

### Key agent/tool files

- `pkg/actions/src/core/agent.ts` — Agent action: prompt → tool → iterate loop
- `pkg/action-kit/src/agent-tool.ts` — Agent/tool type contracts
- `pkg/core/src/services/agent-tools/agent-tool-registry.ts` — Registry + global singleton
- `pkg/core/src/services/agent-tools/builtin/` — Standalone tools
- `pkg/actions/src/registry/` — Action registry (primary source of tools)
- `pkg/actions/src/action-executor.ts` — `executeActionAsNode` / `executeActionAsTool` / `createToolExecutorForAction`
- `pkg/core/src/services/ai/openai-adapter.ts` / `anthropic-adapter.ts` / `openrouter-adapter.ts`
- `pkg/ui/src/components/nodes/AgentNode.tsx` / `ToolSelectorModal.tsx`

## OAuth2 Credential System

Flowlib supports OAuth2 for connecting to third-party services (Google, GitHub, Slack, etc.). Handles authorization, token exchange, and automatic refresh.

### Architecture

```
OAuth2 Provider Registry  — pkg/core/src/services/credentials/oauth2-providers.ts
  ~35 built-in providers: Google (Docs/Sheets/Drive/Gmail/Calendar/Analytics),
  Microsoft 365, GitHub, Slack, Jira, Confluence, Notion, Linear, HubSpot,
  Salesforce, Stripe, Shopify, Zendesk, Asana, Trello, GitLab, Discord, Zoom,
  Dropbox, Box, Figma, Airtable, Intercom, Twitter/X, LinkedIn, Spotify,
  Freshdesk, PagerDuty, QuickBooks, Mailchimp, PayPal, …

OAuth2Service            — pkg/core/src/services/credentials/oauth2.service.ts
  startAuthorizationFlow() → Generate auth URL + PKCE
  exchangeCodeForTokens() → Exchange code for tokens
  refreshAccessToken()    → Refresh expired tokens
  State management for CSRF protection

CredentialsService       — pkg/core/src/services/credentials/credentials.service.ts
  getDecryptedWithRefresh() → Auto-refresh on use
  Encrypted storage via EncryptionService
```

### Flow sequence

```
1. "Connect Google Docs" → POST /credentials/oauth2/start
   → OAuth2Service.startAuthorizationFlow() → { authorizationUrl, state }
2. Frontend opens popup with authorizationUrl; user authorizes in Google UI
   → Google redirects to callback with ?code=…&state=…
3. Popup postMessage's code+state to parent → POST /credentials/oauth2/callback
   → OAuth2Service.exchangeCodeForTokens() → encrypted Credential record created
4. At runtime: credentialsService.getDecryptedWithRefresh(credentialId)
   → If expired && has refreshToken → refresh and persist
   → Return credential with valid accessToken
```

### API endpoints

| Endpoint                            | Method | Description                                 |
| ----------------------------------- | ------ | ------------------------------------------- |
| `/credentials/oauth2/providers`     | GET    | List all OAuth2 providers                   |
| `/credentials/oauth2/providers/:id` | GET    | Specific provider details                   |
| `/credentials/oauth2/start`         | POST   | Start flow, return auth URL                 |
| `/credentials/oauth2/callback`      | POST   | Exchange code for tokens, create credential |
| `/credentials/oauth2/callback`      | GET    | Handle OAuth callback redirect              |
| `/credentials/:id/refresh`          | POST   | Force refresh a credential                  |

### Adding a new OAuth2 provider

Add to `pkg/core/src/services/credentials/oauth2-providers.ts`:

```typescript
my_service: {
  id: "my_service",
  name: "My Service",
  description: "Access My Service API",
  icon: "Cloud",  // Lucide icon name
  authorizationUrl: "https://myservice.com/oauth/authorize",
  tokenUrl: "https://myservice.com/oauth/token",
  defaultScopes: ["read", "write"],
  additionalAuthParams: { /* provider-specific */ },
  supportsRefresh: true,
  docsUrl: "https://myservice.com/docs/oauth",
  category: "other",
},
```

### Frontend components

- `OAuth2ProviderSelector` — Modal to browse/select providers, enter client creds
- `OAuth2ConnectButton` — Triggers the popup flow
- `OAuth2CallbackHandler` — Component for the `/oauth/callback` page

### Using OAuth2 credentials in actions

```typescript
export const myAction = defineAction({
  id: 'my_provider.my_action',
  credential: {
    required: true,
    oauth2Provider: 'my_service',
    description: 'My Service OAuth2 credential',
  },
  async execute(params, context) {
    const credential = context.credential;
    if (!credential?.config?.accessToken) {
      return { success: false, error: 'OAuth2 credential required' };
    }
    const response = await fetch('https://api.example.com/data', {
      headers: { Authorization: `Bearer ${credential.config.accessToken}` },
    });
    return { success: true, output: await response.json() };
  },
});
```

`CredentialConfig` for OAuth2: `accessToken`, `refreshToken`, `tokenType`, `scope`, `expiresAt`, `clientId`, `clientSecret`, `oauth2Provider`, `authorizationUrl?`, `tokenUrl?`.

## Pitfalls & Key Files

**Pitfalls**: Node executors are singletons (use `NodeExecutionContext` for state) | Always Zod-validate inputs | Handle batch `state: "PENDING"` | Test SQLite + PostgreSQL | Types from `@flowlib/core/types` or `@flowlib/action-kit` (never duplicate) | Restart watch if stalled

### tsconfig `paths` inheritance & pnpm workspace bundling (CRITICAL)

The root `tsconfig.json` has `"paths": { "src/*": ["pkg/core/src/*"] }` for core development convenience. **Any package tsconfig that extends root MUST override `paths` to `{}`**, otherwise tsdown/rolldown follows the alias into core's source tree and inlines all of `@flowlib/core` (18+ MB) into the package dist instead of keeping it external.

**Root cause**: pnpm workspace links `@flowlib/core` via symlink (`node_modules/@flowlib/core → ../../../core`). When tsdown resolves imports, the inherited `src/*` path alias redirects the resolver into `../core/src/...` — a relative file path — so `external` / `deps.neverBundle` patterns like `@flowlib/core` never match. Fix: override `paths: {}` so tsdown resolves `@flowlib/core` as a bare package specifier.

Root tsconfig also has `"noEmit": true`. Packages that use `tsc --emitDeclarationOnly` must override `"noEmit": false` or tsc silently emits zero `.d.ts` files (exits 0 with no output).

```jsonc
// CORRECT — any pkg extending root tsconfig
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false, // Override root's noEmit: true
    "baseUrl": ".",
    "paths": {}, // CRITICAL — override root's src/* alias
  },
}
```

**Symptoms if missing**: dist output is 18+ MB | `head dist/index.js` shows `from "./pkg/core/src/..."` instead of `from "@flowlib/core"` | `tsc --emitDeclarationOnly` produces no `.d.ts` files.

**tsdown v0.21+**: use `deps.neverBundle` (not deprecated `external`), and `outExtensions` (plural — singular is silently ignored).

### Key files

**Core execution**: `pkg/core/src/services/flow-orchestration.service.ts` | `services/flow-orchestration/flow-run-coordinator.ts` | `services/flow-orchestration/node-execution-coordinator.ts` | `services/templating/template.service.ts` | `services/service-factory.ts` | `database/schema-*.ts` | `types/` + `types.internal.ts` + `types.frontend.ts` | `schemas/`

**Actions / tools**: `pkg/action-kit/src/` (types) | `pkg/actions/src/registry/` | `pkg/actions/src/action-executor.ts` | `pkg/actions/src/providers.ts` | `pkg/core/src/actions/` (core-side bridge/barrel) | `pkg/core/src/services/agent-tools/agent-tool-registry.ts`

**Plugins**: `pkg/core/src/types/plugin.types.ts` | `services/plugin-manager.ts` | `database/core-schema.ts` | `database/schema-merger.ts` | `database/schema-generator.ts` | `database/schema-verification.ts` | all `pkg/plugins/*/`

**CLI**: `pkg/cli/src/commands/` | `pkg/cli/src/generators/` | `pkg/cli/src/utils/config-loader.ts`

**Primitives**: `pkg/primitives/src/flow-executor.ts` | `primitives/src/action-executor.ts` | `primitives/src/emitter/sdk-source.ts`

## When Adding/Updating/Removing Node Types

All node types are added as **actions** using `defineAction()`.

### Adding a new action

#### 1. Create the file

For an integration provider action, create `pkg/actions/src/<provider>/<action-name>.ts`:

```typescript
import { defineAction } from '@flowlib/action-kit';
import { MY_PROVIDER } from '../providers';
import { z } from 'zod';

export const myAction = defineAction({
  id: 'my_provider.my_action', // Node type string
  name: 'My Action',
  description: 'What this action does',
  provider: MY_PROVIDER,

  params: {
    schema: z.object({
      /* … */
    }),
    fields: [{ name: 'param1', label: 'Parameter', type: 'text', required: true }],
  },

  async execute(params, context) {
    // params: Zod-validated, template-resolved
    // context.credential: OAuth2 tokens (if needed)
    // context.incomingData: upstream node outputs
    // context.functions: service fns (submitPrompt, getCredential, …)
    return { success: true, output: result };
  },
});
```

For a **core runtime primitive** (rare — needs core-only dependencies), still put it in `pkg/actions/src/core/` but be aware that `@flowlib/primitives` may fork it in `pkg/primitives/src/actions/` to avoid QuickJS or other Node-only deps.

#### 2. Register

1. Export from `pkg/actions/src/<provider>/index.ts` barrel
2. Add to the provider bundle (e.g., `gmailActions = [...]`). Bundles auto-include in `allProviderActions`.
3. If introducing a new provider, add a `ProviderDef` to `pkg/actions/src/providers.ts` and its bundle export to `pkg/actions/src/index.ts`

#### 3. Frontend (if needed)

- Most actions render automatically via the dynamic node system
- Custom node visuals → `pkg/ui/src/components/nodes/`
- Node palette reads action definitions from the API

#### 4. Framework packages (rarely needed)

- Standard execution path handles actions automatically
- Only add custom routes if the action needs dedicated testing/preview endpoints

### Areas that may still need updates

**Type system**: export new types from `@flowlib/action-kit` or `pkg/core/src/types.frontend.ts` for frontend consumption. Remember — `types.frontend.ts` uses `import type` only.

**Database (if action stores data)**: update ALL THREE schemas (`schema-sqlite.ts`, `schema-postgres.ts`, `schema-mysql.ts`), then `npx flowlib-cli generate`.

### Common pitfalls

- Missing from provider bundle → invisible at runtime
- Backend types updated but not exported for frontend → import errors
- Partial database updates (one schema file) → crashes on other dialects
- Missing Zod schema → invalid data passes through
- Stale type caches — bundler not rebuilding → stale imports
- Runtime imports in `types.frontend.ts` → frontend build breaks

## When Adding New Features (Non-Node)

1. **New service** — add to `pkg/core/src/services/`, wire in `service-factory.ts`, export from `pkg/core/src/index.ts`
2. **New API endpoint** — add service method, expose via `createFlowlib()` sub-API (edit `pkg/core/src/api/<domain>.ts` + `pkg/core/src/api/types.ts`), add routes in framework packages, update frontend API client (`pkg/ui/src/api/`)
3. **Database schema change** — update all three schema files, run `npx flowlib-cli generate`, test migration

## Plugin System

Flowlib has a **composable plugin system** where plugins declare actions, lifecycle hooks, API endpoints, database schema, and middleware. Plugins span backend AND frontend.

### Plugin architecture

```
┌─────────────────────────────────────────────────────┐
│         FlowlibPluginDefinition (unified)            │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  backend:    │  │  frontend:                  │  │
│  │  FlowlibPlugin│  │  FlowlibFrontendPlugin       │  │
│  │  (hooks,     │  │  (sidebar, routes, panels,  │  │
│  │   endpoints, │  │   components, providers)    │  │
│  │   schema,    │  └─────────────────────────────┘  │
│  │   actions)   │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
         │                  │
         ▼                  ▼
   Backend framework   <Flowlib /> component
   extracts .backend   extracts .frontend
```

### `FlowlibPluginDefinition` (the unified top-level factory return)

Plugin factory functions (like `auth()`, `rbac()`, `webhooks()`, `vercelWorkflowsPlugin()`) return `FlowlibPluginDefinition`, not `FlowlibPlugin` directly:

```typescript
interface FlowlibPluginDefinition {
  id: string;
  name?: string;
  backend?: FlowlibPlugin; // The backend surface (hooks, endpoints, schema, actions)
  frontend?: unknown; // `FlowlibFrontendPlugin` — typed `unknown` in core to avoid React dep
}
```

Example (simplified from `pkg/plugins/auth/src/backend/index.ts`):

```typescript
export function auth(options: AuthenticationPluginOptions = {}): FlowlibPluginDefinition {
  return {
    id: 'user-auth',
    name: 'User Authentication',
    backend: authentication(options), // returns FlowlibPlugin
    frontend: options.frontend, // authFrontend from @flowlib/user-auth/ui
  };
}
```

Users pass these into `createFlowlib({ plugins: [auth({ … }), rbac(), …] })`.

### `FlowlibPlugin` (backend surface)

```typescript
interface FlowlibPlugin {
  id: string;
  name?: string;
  init?: (ctx: FlowlibPluginContext) => Promise<FlowlibPluginInitResult | void>;
  schema?: FlowlibPluginSchema;             // Abstract DB tables (dialect-agnostic)
  requiredTables?: string[];                // Startup existence check (inferred from schema if omitted)
  actions?: ActionDefinition[];             // Flow nodes + agent tools
  endpoints?: FlowlibPluginEndpoint[];       // Custom API routes
  hooks?: FlowlibPluginHooks;                // Lifecycle hooks (7 points)
  setupInstructions?: string;               // Shown when required tables are missing
  $ERROR_CODES?: Record<string, {...}>;     // Custom error codes
  shutdown?: () => Promise<void> | void;    // Cleanup on shutdown
}
```

### Plugin hooks

| Hook                | When                     | Can short-circuit?                                                |
| ------------------- | ------------------------ | ----------------------------------------------------------------- |
| `beforeFlowRun`     | Before flow execution    | Yes — `{ cancel: true }` stops the run, or `{ inputs }` overrides |
| `afterFlowRun`      | After flow completes     | No                                                                |
| `beforeNodeExecute` | Before each node         | Yes — `{ skip: true }` skips, or `{ params }` overrides           |
| `afterNodeExecute`  | After each node          | No, but can return `{ output }` to override                       |
| `onRequest`         | Before every API request | Yes — `{ response }` intercepts, `{ request }` modifies           |
| `onResponse`        | After every API response | Can return `{ response }` to replace                              |
| `onAuthorize`       | During auth checks       | Yes — `{ allowed: true/false }` overrides                         |

### Frontend plugin interface

`FlowlibFrontendPlugin` is defined in `pkg/plugins/rbac/src/frontend/types.ts` (not yet promoted to core). Contributes UI:

```typescript
interface FlowlibFrontendPlugin {
  id: string;
  name?: string;
  sidebar?: PluginSidebarContribution[];
  routes?: PluginRouteContribution[];
  panelTabs?: PluginPanelTabContribution[];
  headerActions?: PluginHeaderActionContribution[];
  components?: Record<string, ComponentType>;
  providers?: ComponentType<{ children }>[];
  apiHeaders?: () => Record<string, string>;
  checkPermission?: (perm, ctx?) => boolean | undefined;
}
```

### Registration & lifecycle

```typescript
const flowlib = await createFlowlib({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY!,
  plugins: [
    auth({ globalAdmins: [{ email: 'admin@example.com', pw: '…', name: 'Admin' }] }),
    rbac(),
  ],
});
```

**Init sequence** (in `createFlowlib()`):

1. Action registry created; all built-in actions registered (`allProviderActions`)
2. `pluginManager.initializePlugins()` — for each plugin: register `backend.actions`, then `backend.init(context)`
3. `registerActionsAsTools()` — all actions converted to agent tools
4. `initializeServices()` — `ServiceFactory` built, `DatabaseService.initialize()`:
   - Core table existence check (from `core-schema.ts`)
   - Plugin table existence check (`requiredTables` or inferred from `schema`)
   - Opt-in detailed schema verification (columns)

**Shutdown**: plugins shut down in **reverse order**.

### Official plugins

- **`@flowlib/user-auth`** (`pkg/plugins/auth`) — Light wrapper around [Better Auth](https://better-auth.com). Backend wraps a Better Auth instance, proxies auth routes as plugin endpoints. `onRequest` hook resolves sessions; `onAuthorize` enforces session-based access. **Admin-only user management**: sign-up is disabled; initial admin seeded from `FLOWLIB_ADMIN_EMAIL` / `FLOWLIB_ADMIN_PASSWORD` or `adminEmail`/`adminPassword` options. Frontend contributes an `appShell` (`AuthAppShell`) that wraps the Flowlib layout with `AuthProvider` + `AuthGate`, plus a `/users` route, a `/profile` route, a `Users` sidebar item, and a `SidebarUserMenu` footer. Also exports: `AuthProvider`, `useAuth`, `SignInForm`, `SignInPage`, `TwoFactorSetup`, `TwoFactorVerifyForm`, `UserButton`, `AuthGate`, `UserManagement`, `authFrontend`. The legacy `AuthenticatedFlowlib` wrapper is still exported for back-compat but no longer recommended — pass `auth()` through `<Flowlib config={{ plugins }} />` instead.
- **`@flowlib/rbac`** (`pkg/plugins/rbac`) — Role-Based Access Control. Depends on auth. Backend provides flow-access endpoints; `onAuthorize` enforces flow-level ACLs. Frontend contributes sidebar items, `/access` routes, `FlowAccessPanel`, `ShareButton`, `RbacProvider`, teams management.
- **`@flowlib/webhooks`** (`pkg/plugins/webhooks`) — Webhook management, ingestion, signature verification, dedicated UI page.
- **`@flowlib/version-control`** (`pkg/plugins/version-control`) — Sync flows to GitHub/GitLab/Bitbucket as `.flow.ts` files. Enables Git-stored flows deployed via CI/CD.
- **`@flowlib/cloudflare-agents`** (`pkg/plugins/cloudflare-agents`) — Compile Flowlib flows to Cloudflare Agents & Workflows; deploy visual flows as durable globally-distributed Workers. Has `backend/`, `compiler/`, `adapter/`, `shared/`.
- **`@flowlib/vercel-workflows`** (`pkg/plugins/vercel-workflows`) — Compile Flowlib flows to **Vercel Workflows** (`'use workflow'` directive). Has `backend/endpoints.ts`, `compiler/` (flow-compiler, control-flow, step-emitter), `runtime/execute-step.ts`, `frontend/DeployButton.tsx`, plus `runner.ts` (`createVercelFlowRunner`). **Deploy UX**: the Deploy button shows the generated source for copy-paste into the user's Next.js app — it is NOT a CLI deploy. The plugin's `/deploy/preview` endpoint returns both the compiled `'use workflow'` source and the SDK-source file it imports.
- **`@flowlib/mcp`** (`pkg/plugins/mcp`) — Exposes flow building/editing/execution/debugging as MCP tools for Claude Desktop, VS Code Copilot, other MCP clients. Includes server (`backend/`), stdio launcher (`cli/`), and resources/prompts.

### Frontend composition: `<Flowlib config>` + plugins

`<Flowlib>` (from [pkg/ui/src/Flowlib.tsx](pkg/ui/src/Flowlib.tsx)) is always the main component. Hosts pass a single `config` object (the same shape as `defineConfig({...})` on the backend) containing `apiPath`, `frontendPath`, `theme`, and a unified `plugins` array. The component reads only the frontend-relevant fields and ignores the rest, so the same `flowlib.config.ts` can be imported by both backend and frontend.

```tsx
import { Flowlib } from '@flowlib/ui';
import '@flowlib/ui/styles';
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';
import { webhooks } from '@flowlib/webhooks';

<Flowlib
  config={{
    apiPath: 'http://localhost:3000/flowlib',
    frontendPath: '/flowlib',
    theme: 'dark',
    plugins: [auth(), rbac(), webhooks()],
  }}
/>;
```

#### How plugin auth gating works

Each plugin factory returns an `FlowlibPluginDefinition` with optional `.backend` and `.frontend` surfaces. On the frontend, `resolvePlugins()` extracts `.frontend` from each; the backend extracts `.backend`. Plugin packages ship a `browser` export condition (see [pkg/plugins/auth/src/browser.ts](pkg/plugins/auth/src/browser.ts)) that Vite/webpack resolves to a frontend-only entry returning `{ id, name, frontend: authFrontend }` — no better-auth runtime is bundled client-side.

A frontend plugin can contribute an **`appShell`** ([pkg/ui/src/types/plugin.types.ts:111](pkg/ui/src/types/plugin.types.ts#L111)) — a component that wraps the entire Flowlib layout and can conditionally render `children`. The auth plugin uses this to gate access: when unauthenticated, the shell renders a sign-in page; once authenticated, it renders the children (the full Flowlib app). Only the **first** plugin with an `appShell` wins.

```
<Flowlib config>
  ThemeProvider
    QueryClientProvider
      ApiProvider
        FrontendPathProvider
          PluginRegistryProvider
            FlowlibShelled ─ resolves AppShell from plugin registry
              ↳ AuthAppShell (from @flowlib/user-auth)
                  AuthProvider → AuthGate
                    ├─ fallback: SignInPage / TwoFactorVerifyForm
                    └─ children:
                        FlowlibAppContent (.imp-shell — CSS scope)
                          Sidebar + <Outlet />
```

The auth plugin's shell is [pkg/plugins/auth/src/frontend/components/AuthAppShell.tsx](pkg/plugins/auth/src/frontend/components/AuthAppShell.tsx), registered via [pkg/plugins/auth/src/frontend/plugins/authFrontendPlugin.ts](pkg/plugins/auth/src/frontend/plugins/authFrontendPlugin.ts) as `appShell: AuthAppShell`.

#### CSS scope

`@flowlib/ui/styles` defines theme tokens (`--imp-background`, `--imp-foreground`, …) and Tailwind utilities. The `.imp-shell` class sits on the top-level div inside `FlowlibAppContent`. Sign-in / 2FA pages render outside that div (the shell is a sibling of `FlowlibAppContent`, not a parent), so theme tokens must be available at `:root` or inherited from `ThemeProvider`'s class toggle — plugin UI components just use `imp-*` utility classes directly and they work.

#### Rules for plugin frontend components

1. **Always use `imp-*` theme tokens** (`bg-imp-background`, `text-imp-foreground`, `border-imp-border`, …). Never raw colors.
2. **Don't import `@flowlib/ui` from a plugin frontend** unless you're only importing _types_ (`FlowlibFrontendPlugin`, `PluginSidebarContribution`, …). Plugin UI lives above `@flowlib/ui` in the dependency graph — importing runtime from it creates a cycle.
3. **Plugin routes / panel tabs / sidebar items / appShell** are wired through the `FlowlibFrontendPlugin` shape. See [pkg/ui/src/types/plugin.types.ts](pkg/ui/src/types/plugin.types.ts) for all extension points.
4. **Dark mode** — `ThemeProvider` (applied inside `<Flowlib>`) toggles the class; `system` resolves via OS preference listener.

#### Legacy: `AuthenticatedFlowlib` and `FlowlibShell`

`AuthenticatedFlowlib` ([pkg/plugins/auth/src/frontend/components/AuthenticatedFlowlib.tsx](pkg/plugins/auth/src/frontend/components/AuthenticatedFlowlib.tsx)) and `FlowlibShell` (CSS-scope-only wrapper, still exported from `@flowlib/ui`) are retained for back-compat but are **no longer the recommended pattern**. New hosts should render `<Flowlib config>` directly and let the auth plugin's `appShell` handle gating.

### Plugin schema system

Plugins declare DB tables using an **abstract format** (dialect-agnostic). The CLI merges core + plugin schemas and generates dialect-specific Drizzle files.

Two distinct mechanisms:

1. **`schema`** — Abstract table definitions consumed by `npx flowlib-cli generate`. Plugins that declare `schema` get their tables included in the generated output automatically.
2. **`requiredTables`** — Table names checked at **startup** (existence only). Used when a plugin relies on externally-managed tables (e.g., Better Auth creates its own). If `requiredTables` is omitted but `schema` is declared, names are **inferred from `schema`**.

The auth plugin uses **both**: `schema` (so generator includes auth tables) AND `requiredTables` (so startup verifies them).

```typescript
const myPlugin: FlowlibPlugin = {
  id: 'my-plugin',
  schema: {
    my_table: {
      fields: {
        id: { type: 'string', primaryKey: true },
        name: { type: 'string', required: true },
        flowId: { type: 'string', references: { table: 'flows', field: 'id' } },
      },
    },
    // Extend existing core table (additive only — fields merged in)
    flows: {
      fields: { tenantId: { type: 'string' } },
    },
  },
  requiredTables: ['my_table'], // Optional; inferred if omitted
};
```

#### Startup verification

During `DatabaseService.initialize()`:

1. **Core table check** — from `core-schema.ts`
2. **Plugin table check** — `requiredTables` (explicit) or inferred from `schema`. Missing tables → clear plugin-attributed error with setup instructions pointing to:

```
npx flowlib-cli generate   # regenerate Drizzle files (core + plugins)
npx drizzle-kit push      # push schema to the database
```

### Adding a new plugin

1. Create `pkg/plugins/<name>/` with `src/backend/`, `src/frontend/`, `src/shared/` (and optional `browser.ts`)
2. Backend: export a factory returning `FlowlibPlugin` (or `FlowlibPluginDefinition` directly)
3. Frontend: export an `FlowlibFrontendPlugin` object
4. Shared: export browser-safe types only
5. Top-level factory: return `{ id, name, backend, frontend }` (i.e., `FlowlibPluginDefinition`)
6. If plugin has DB tables: declare `schema`, run `npx flowlib-cli generate`
7. Register in consumer app: `plugins: [myPlugin()]`

### Key plugin files

- `pkg/core/src/types/plugin.types.ts` — All plugin type definitions
- `pkg/core/src/services/plugin-manager.ts` — Lifecycle + hook execution
- `pkg/core/src/api/create-flowlib.ts` — Modern factory entry point
- `pkg/core/src/flowlib-core.ts` — Legacy `Flowlib` class (internal)
- `pkg/core/src/database/core-schema.ts` — Core DB tables (abstract)
- `pkg/core/src/database/schema-merger.ts` — Merges core + plugin schemas
- `pkg/core/src/database/schema-generator.ts` — Generates dialect-specific Drizzle files
- `pkg/core/src/database/schema-verification.ts` — Detailed startup verification (opt-in)
- `pkg/core/src/services/database/database.service.ts` — Startup existence checks
- `pkg/plugins/auth/` | `rbac/` | `webhooks/` | `version-control/` | `cloudflare-agents/` | `vercel-workflows/` | `mcp/`

## CLI (`@flowlib/cli`)

`npx flowlib-cli <command>` manages project init, schema generation, migrations. Published as `@flowlib/cli`; the `flowlib-cli` bin lives in `pkg/flowlib/` (thin wrapper).

### Commands

| Command                   | Description                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npx flowlib-cli init`     | Interactive setup wizard — detects framework, installs deps, creates `flowlib.config.ts`, generates schemas, runs initial migration |
| `npx flowlib-cli generate` | Generates Drizzle schema files (all 3 dialects) from core + plugin schemas; optionally chains to migration                         |
| `npx flowlib-cli migrate`  | Applies pending migrations via `drizzle-kit migrate` or pushes directly with `drizzle-kit push` (dev mode)                         |
| `npx flowlib-cli info`     | Diagnostic info — system, frameworks, databases, config, plugins                                                                   |
| `npx flowlib-cli secret`   | Cryptographically secure 32-byte base64 key for `FLOWLIB_ENCRYPTION_KEY`                                                            |
| `npx flowlib-cli mcp`      | Launches stdio MCP server for IDE/Claude integration (`--url`, `--api-key`, `--print-config`)                                      |

### Config shape

The `FlowlibConfig` schema is defined in [pkg/core/src/schemas/flowlib-config.ts](pkg/core/src/schemas/flowlib-config.ts). `defineConfig()` is available from two entry points:

- **`@flowlib/core`** — full entry; the identity function is co-located with the Zod schema (Node-only).
- **`@flowlib/core/config`** — browser-safe entry ([pkg/core/src/config.ts](pkg/core/src/config.ts)): identity function + type re-exports only, no Zod, no Node APIs. Use this if the config file is imported into a browser bundle.

Required fields: `database` and `encryptionKey`. Optional top-level fields: `apiPath`, `frontendPath`, `theme`, `logging`, `logger`, `execution`, `triggers`, `plugins`, `defaultCredentials`.

`database` shape: `{ type: 'postgresql' | 'sqlite' | 'mysql', connectionString: string, name?: string, driver?: ... }`. The optional `driver` picks the underlying client (`postgres` / `pg` / `neon-serverless` for PG, `better-sqlite3` / `libsql` for SQLite, `mysql2` for MySQL).

The same config object is shared between backend and frontend. `<Flowlib config>` reads only `apiPath`, `frontendPath`, `theme`, and `plugins` — other fields pass through the typed `[key: string]: unknown` escape hatch without error.

```typescript
// flowlib.config.ts
import { defineConfig } from '@flowlib/core';
import { auth } from '@flowlib/user-auth';
import { rbac } from '@flowlib/rbac';

export default defineConfig({
  database: { type: 'sqlite', connectionString: 'file:./dev.db' },
  encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY!,
  apiPath: '/api/flowlib',
  frontendPath: '/flowlib',
  theme: 'dark',
  plugins: [auth({ globalAdmins: [{ email: 'admin@example.com', pw: '…' }] }), rbac()],
});
```

### Config loading (CLI)

The CLI loader lives at [pkg/cli/src/utils/config-loader.ts](pkg/cli/src/utils/config-loader.ts). It is used by `flowlib-cli generate` / `migrate` / `info` to discover plugins and extract `.backend.schema` for codegen.

1. **Discovery** — explicit `--config` first; otherwise search `flowlib.config.{ts,js,mjs}` in `.`, `src`, `lib`, `config`, `utils` (in that order).
2. **TSConfig alias resolution** — reads `tsconfig.json` (falling back to `jsconfig.json`) and follows `references` for monorepo project-reference setups (with cycle protection). Collected `paths` aliases are passed to jiti as `alias:`.
3. **Loading** — jiti with `interopDefault: true` and the resolved aliases. Supports TypeScript source and both CJS / ESM output.
4. **Export resolution** — accepts any of: `export default`, `export const config`, `export const flowlibConfig`, or a module whose root has `database`/`plugins`. Double-wrapped defaults (`{ default: { default: … } }`) are unwrapped.
5. **Plugin extraction** — iterates `config.plugins`; each entry must be an object with an `id` property. The loader then pulls `.backend` out of each (frontend-only plugins are skipped for schema generation).

Note: the CLI loader does **not** invoke `FlowlibConfigSchema.parse()`. Full Zod validation happens later inside `createFlowlib()` at runtime.

### Schema generation pipeline

```
flowlib-cli generate
  ├── Load flowlib.config.ts (config-loader.ts)
  ├── Import core schema + dialect generators from @flowlib/core
  ├── mergeSchemas(coreSchema, ...pluginSchemas)
  │   └── Validates no conflicting field definitions
  ├── Generate 3 dialect files (SQLite, PostgreSQL, MySQL)
  │   └── Compare against existing files → skip unchanged
  ├── Display summary (table counts, per-plugin details)
  ├── Prompt for confirmation
  ├── Write changed files to disk
  └── Optionally chain to `flowlib-cli migrate`
```

### CLI key files

- `pkg/cli/src/index.ts` — Entry point (Commander.js)
- `pkg/cli/src/api.ts` — Programmatic API
- `pkg/cli/src/commands/` — Command implementations (init, generate, migrate, info, secret, mcp)
- `pkg/cli/src/generators/` — Schema generators (Drizzle + Prisma)
- `pkg/cli/src/utils/config-loader.ts` — Discovery + jiti
- `pkg/cli/test/` — Generation, diff, Prisma merge, fixtures

## Primitives (`@flowlib/primitives`)

`@flowlib/primitives` is a **lightweight, DB-less, framework-less flow runner**. It runs Flowlib flow definitions in any JS runtime (Node, Cloudflare Workers, Vercel Edge, Vercel Workflows, Deno, Bun).

### What it provides

- `createFlowRunner(config)` — build a runner with a durability adapter (`InMemoryAdapter` or external)
- `InMemoryAdapter` — no-op adapter for simple in-process runs
- `defineFlow`, node helpers (`input`, `output`, `model`, `ifElse`, `switchNode`, `agent`, `tool`, `code`, `javascript`, `node`, `edge`) — the same TypeScript flow builder API surface as `@flowlib/core/sdk`
- `validateFlow` / `topologicalSort` / `buildNodeContext` / `resolveCallableParams` / `executeNodeAction`
- `emitSdkSource()` — converts a DB-form `FlowlibDefinition` back to a TypeScript source string (used by the Vercel Workflows plugin to generate the deployable flow file)
- `createFetchPromptClient()` — HTTP-based prompt client for environments without direct AI SDK access
- Primitive-specific action forks (`ifElseAction`, `switchAction`, `javascriptAction`, `outputAction`) that avoid QuickJS so flows can run on edge runtimes

### Durability adapter contract

```typescript
interface DurabilityAdapter {
  step<T>(name: string, fn: () => Promise<T>, options?: StepOptions): Promise<T>;
  sleep(duration: string | number): Promise<void>;
  waitForEvent<T>(name: string, options?: { timeout?: string }): Promise<T>;
  subscribe<T>(name: string): AsyncIterable<T>;
}
```

External runtimes (Vercel Workflows, Cloudflare Workflows) supply adapters that map `step` to their durable-execution primitive.

### Node-type aliases

`@flowlib/primitives` exports `INPUT_TYPES`, `OUTPUT_TYPES`, `MODEL_TYPES`, `JAVASCRIPT_TYPES`, `IF_ELSE_TYPES`, `SWITCH_TYPES`, `AGENT_TYPES`, `ALL_PRIMITIVE_TYPES` plus `isInputType`/`isOutputType`/etc. guards — used because an action ID like `core.javascript` may have both a "primitives.javascript" alias and a "core.javascript" alias in flow definitions.

## Playwright Tests

Playwright validates API parity across framework adapters, frontend rendering, and end-to-end UI workflows.

### Running

```bash
pnpm test:pw            # api + frontend + e2e + critical-paths (with port check)
pnpm test:pw:force-kill # same, but kills processes on required ports first
pnpm test:pw:ui         # Interactive UI mode
pnpm test:pw:headed     # Headed browser mode
```

### Structure

```
playwright/
├── playwright.config.ts            # Multiple projects + shared web servers
└── tests/
    ├── fixtures.ts                  # Shared helpers
    ├── seed.spec.ts                 # Bootstrap — proves app is alive
    ├── nest-prisma-installation.spec.ts  # NestJS+Prisma example setup (180s timeout)
    ├── config-panel/                # Node config panel UI
    ├── credentials/                 # Credential management (CRUD, webhooks)
    ├── critical-paths/              # Important user workflows
    ├── examples/                    # nextjs-drizzle-auth-rbac setup (120s timeout)
    └── platform/                    # Cross-platform API parity + frontend rendering
        ├── shared-api-contract.ts   # runApiContract() — shared CRUD contract
        ├── test-server.ts           # Isolated Express test server spawner
        ├── test-server-nestjs.ts    # Isolated NestJS test server
        ├── test-server-nextjs.ts    # Isolated Next.js handler test server
        ├── platform-fixtures.ts     # Server isolation fixtures
        ├── express-api.spec.ts / nestjs-api.spec.ts / nextjs-api.spec.ts
        ├── express-frontend.spec.ts / nextjs-frontend.spec.ts
        ├── nextjs-frontend.fixtures.ts
        └── README.ts
```

### Projects

| Project                      | Match                                            | Description                                          |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| **api**                      | `platform/(express\|nestjs\|nextjs)-api.spec.ts` | API parity — each worker spawns isolated server      |
| **frontend**                 | `platform/(express\|nextjs)-frontend.spec.ts`    | Frontend rendering — shared dev servers              |
| **e2e**                      | Everything outside `platform/`                   | Config panel, credentials, seed — shared dev servers |
| **critical-paths**           | `critical-paths/*.spec.ts`                       | Important user workflows                             |
| **nest-prisma**              | `nest-prisma-installation.spec.ts`               | NestJS+Prisma example setup (180s timeout)           |
| **nextjs-drizzle-auth-rbac** | `examples/nextjs-drizzle-auth-rbac-*.spec.ts`    | Full Next.js+Auth+RBAC (120s timeout)                |
| **visual-audit**             | `visual-audit/capture.ts`                        | Screenshot capture for UX analysis                   |

### Database isolation

**API tests (`platform/`)**: each Playwright **worker** gets a fully isolated SQLite database:

1. Temp file created per worker
2. Drizzle migrations run from `pkg/core/drizzle/` on the fresh file
3. Child-process test server (Express / NestJS / Next.js) spawned on a random free port with `DATABASE_URL` pointing at the temp file
4. After all tests finish, the child is killed and the DB file (plus `-journal`, `-wal`, `-shm`) deleted

**Frontend / e2e tests**: use the shared Express dev server on port 3000 with `dev.db` in `examples/express-drizzle/`.

### Shared API contract (`shared-api-contract.ts`)

`runApiContract()` validates **identical behavior** across Express, NestJS, and Next.js:

1. Flow CRUD — List → Create → Get → Versions → React Flow → Delete
2. Credential CRUD — List → Create → Get → Test → Delete → Verify deleted
3. Agent tools — non-empty array with `id`/`name`
4. Node data — valid response
5. Flow runs — valid response
6. Cleanup — deletes test flows/credentials by name pattern

### Shared web servers (frontend/e2e only)

`playwright.config.ts` starts:

1. **Vite frontend** (from `examples/vite-react-frontend/`) — port via `PLAYWRIGHT_VITE_PORT`
2. **Next.js example** (from `examples/nextjs-app-router/`) — port via `PLAYWRIGHT_NEXTJS_PORT`

API tests spawn per-worker backends; these shared servers are frontend-only. Reuses existing local instances if already running.

### Custom fixtures (`fixtures.ts`)

Extended Playwright `test` with helpers:

- `navigateToFlow(flowName)` — dashboard → find card → click
- `openNodeConfigPanel(nodeName)` — double-click node, wait for dialog
- `closeConfigPanel()` — press Escape
- `runNode()` / `runNodeAndWait()` — click "Run Node", wait for completion
- `getEditorContent()` / `getEditorJSON()` — CodeMirror editor content
- `ensureNoLoadingSpinner()` — guard against loading-state rendering bugs
- `parseJSON(text)` — parse-or-throw with context

## Core E2E Tests (`pkg/core/tests/e2e/`)

**Programmatic** E2E tests that exercise `Flowlib` core directly (no HTTP, no browser).

- **Run**: `pnpm test:e2e` — initializes with a local SQLite file, runs each example's `setup()` + `run()` + `assert()`
- **Requires**: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for AI-powered tests
- **Entry**: `tests/e2e/run.ts`

| File                                     | AI Required? | What it tests                     |
| ---------------------------------------- | ------------ | --------------------------------- |
| `complex-branching-flow.ts` (2 examples) | No           | If/else branching logic           |
| `input-template-model.ts`                | Yes          | Input → template → AI model chain |
| `comprehensive-flow.ts` (2 examples)     | Yes          | All node types combined           |
| `simple-agent-flow.ts`                   | Yes          | Agent with tool calling           |
| `complex-agent-flow.ts`                  | Yes          | Complex agent workflows           |

## Drizzle Configuration Files

Drizzle config files exist in example apps for their local migrations:

| Location                                              | Dialect    | Schema           | Migrations | DB URL                                                                              | Purpose                           |
| ----------------------------------------------------- | ---------- | ---------------- | ---------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| `examples/express-drizzle/drizzle.config.ts`          | SQLite     | `./db/schema.ts` | `drizzle/` | `DB_FILE_NAME` env                                                                  | Express example migrations        |
| `examples/nextjs-drizzle-auth-rbac/drizzle.config.ts` | PostgreSQL | `./db/schema.ts` | `drizzle/` | `DATABASE_URL` env (default `postgresql://acme:acme@localhost:5432/acme_dashboard`) | Next.js + auth example migrations |

Playwright test servers consume pre-generated SQLite migrations from `pkg/core/drizzle/sqlite/` (generated via `pkg/core/drizzle.config.sqlite.ts`).
