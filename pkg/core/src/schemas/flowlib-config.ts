import { z } from 'zod/v4';

const databaseConfigSchema = z
  .object({
    /**
     * Database connection string.
     *
     * Required for every driver *except* `'d1'`, which uses a runtime
     * `binding` instead.
     */
    connectionString: z.string().min(1, 'Database URL is required').optional(),
    type: z.enum(['postgresql', 'sqlite', 'mysql']),
    name: z.string().optional(), // Human readable name for the database
    /**
     * Underlying driver package to use for database connections.
     * When omitted, a sensible default is chosen per dialect:
     *
     * **PostgreSQL** (default: `'postgres'`):
     * - `'postgres'`          — postgres.js. Fast, pure JS. Default.
     * - `'pg'`                — node-postgres (Pool). Most popular PG driver.
     * - `'neon-serverless'`   — @neondatabase/serverless. WebSocket-based, for Neon + edge.
     *
     * **SQLite** (default: `'better-sqlite3'`):
     * - `'better-sqlite3'`    — Native C++. Fastest for long-running Node servers.
     * - `'libsql'`            — Pure JS / WASM. Works in serverless/edge + Turso.
     * - `'d1'`                — Cloudflare D1 binding. Pass `binding: env.DB`
     *                           instead of a `connectionString`. Workers only.
     *
     * **MySQL** (default: `'mysql2'`):
     * - `'mysql2'`            — Only supported driver.
     */
    driver: z
      .enum([
        // PostgreSQL
        'postgres',
        'pg',
        'neon-serverless',
        // SQLite
        'better-sqlite3',
        'libsql',
        'd1',
        // MySQL
        'mysql2',
      ])
      .optional(),
    /**
     * Cloudflare D1 binding (only used when `driver === 'd1'`).
     *
     * Pass the `D1Database` your Worker received in `env.DB` (or whatever
     * the binding is named in `wrangler.toml`). The shape isn't validated
     * by Zod because `D1Database` is a runtime-only Workers type — the
     * driver checks `.prepare()` exists before use.
     */
    binding: z.unknown().optional(),
  })
  .refine(
    (cfg) => {
      // D1 needs a binding; everything else needs a connectionString.
      if (cfg.driver === 'd1') {
        return cfg.binding !== null && cfg.binding !== undefined;
      }
      return typeof cfg.connectionString === 'string' && cfg.connectionString.length > 0;
    },
    {
      message: 'database config requires `connectionString` (or `binding` when driver is `d1`).',
      path: ['connectionString'],
    },
  );

export type FlowlibDatabaseConfig = z.infer<typeof databaseConfigSchema>;

/**
 * Execution configuration schema
 */
export const ExecutionConfigSchema = z.object({
  defaultTimeout: z.number().positive().default(60000),
  maxConcurrentExecutions: z.number().positive().default(10),
  enableTracing: z.boolean().default(true),
  /**
   * Maximum time (in ms) a flow run is allowed to stay in RUNNING state
   * before being considered stale and marked as FAILED.
   * This is a HEARTBEAT-STALENESS threshold, not a wall-clock budget — as
   * long as the coordinator keeps writing heartbeats, the reaper won't fire.
   * @default 600_000 (10 minutes)
   */
  flowTimeoutMs: z.number().positive().default(600_000),
  /**
   * Per-node timeout (in ms) for `core.model` unless overridden by the node's
   * own `timeoutMs` param. Governs the SDK call wall-clock.
   * @default 300_000 (5 minutes)
   */
  modelNodeTimeoutMs: z.number().positive().default(300_000),
  /**
   * Per-node timeout (in ms) for `core.agent` unless overridden by the node's
   * own `timeoutMs` param. Governs the total wall-clock of the agent loop.
   * @default 900_000 (15 minutes)
   */
  agentNodeTimeoutMs: z.number().positive().default(900_000),
  /**
   * Interval (in ms) at which the heartbeat is updated during flow execution.
   * @default 30_000 (30 seconds)
   */
  heartbeatIntervalMs: z.number().positive().default(30_000),
  /**
   * Interval (in ms) at which the stale run detector polls for stuck runs.
   * @default 60_000 (60 seconds)
   */
  staleRunCheckIntervalMs: z.number().positive().default(60_000),
  /**
   * Interval (in ms) at which the SSE flow-run event stream emits heartbeat
   * frames to keep proxies and load-balancers from idling out the connection.
   * The timer is per-request (not module-level) so it's safe on edge runtimes
   * — it fires only while a client is connected and is cleared on disconnect.
   *
   * Tune higher (e.g. 30_000) on platforms with generous idle timeouts;
   * tune lower (e.g. 5_000) when sitting behind aggressive proxies.
   * @default 15_000 (15 seconds)
   */
  sseHeartbeatIntervalMs: z.number().positive().default(15_000),
  /**
   * Force-disable the `new Function`/eval fast path in `DirectEvaluator`,
   * even when the runtime supports it. Hosts that want CSP-style guarantees
   * (no dynamic code generation under any circumstances) should set this
   * `true` and configure a sandboxed fallback evaluator (e.g. QuickJS).
   *
   * Default `false` — `DirectEvaluator` will use `new Function` when the
   * runtime allows it, and automatically fall back to the configured
   * sandbox evaluator (or throw) when the runtime forbids it.
   *
   * Note: `@flowlib/core`'s server runtime always uses the QuickJS-backed
   * `JsExpressionService` and never `DirectEvaluator`, so this flag only
   * affects edge-runtime hosts (`@flowlib/primitives` consumers, the Vercel
   * Workflows / Cloudflare Workers runtimes) that opt into `DirectEvaluator`.
   *
   * @default false
   */
  disableNativeEval: z.boolean().default(false),
  /**
   * Persistence strategy for node executions during flow runs.
   *
   * - `'per-node'` (default): the historical behavior. Every node execution
   *   writes one row to `flowlib_action_traces` on start and is updated on
   *   completion. Provides full per-node observability while a run is
   *   in-progress (each row is visible immediately) and after it completes.
   *   Cost: 2 writes per node per run. A 30-node run = ~60 row writes.
   *
   * - `'per-run'`: node executions are buffered in-memory for the duration
   *   of the flow run and flushed as a single JSON blob into
   *   `flowlib_flow_executions.node_outputs` when the run finishes (success
   *   OR failure). The `flowlib_action_traces` table is NOT written for
   *   node-level traces in this mode (agent tool traces are unaffected —
   *   their volume is dominated by tool calls, not nodes). A 30-node run
   *   = 1 row write to `flow_runs` plus the regular create/update of the
   *   run itself, regardless of node count. ~30x fewer row writes per run.
   *
   *   **Tradeoff**: while a run is in-progress, node-execution detail is
   *   not durably persisted — only buffered in the executing process's
   *   memory. Consumers (UI, API) reading node executions for an
   *   in-progress run see an empty list. After the run completes, the
   *   read path (`listNodeExecutionsByFlowRunId`) parses the JSON blob
   *   back into the same `NodeExecution[]` shape consumers expect.
   *
   *   Use this mode when you need to fit per-flow-run write volume under
   *   a hard cap (e.g., Cloudflare D1's 50M writes/month) and can accept
   *   eventual consistency for in-flight runs.
   *
   * @default 'per-node'
   */
  persistence: z.enum(['per-node', 'per-run']).default('per-node'),
});

/**
 * Log level enum values
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent']);

/**
 * Logging configuration schema with support for scope-level overrides.
 *
 * Scopes allow independent log level control for different feature areas:
 * - execution: Flow execution orchestration
 * - validation: Flow validation
 * - batch: Batch processing (AI providers)
 * - database: Database operations
 * - node: Node execution
 * - graph: Graph operations (topological sort, etc.)
 * - credentials: Credential management
 * - ai: AI/LLM operations
 * - template: Template rendering
 * - renderer: React Flow rendering
 * - flows: Flow management (CRUD)
 * - versions: Flow version management
 * - http: HTTP/API layer
 *
 * @example
 * ```typescript
 * const config = {
 *   logging: {
 *     level: 'info',  // Default level for all scopes
 *     scopes: {
 *       execution: 'debug',  // Verbose execution logging
 *       validation: 'warn',  // Only validation warnings
 *       batch: 'silent',     // Disable batch logging
 *     }
 *   }
 * };
 * ```
 */
export const LoggingConfigSchema = z.object({
  /** Default log level for all scopes */
  level: LogLevelSchema.default('silent'),
  /** Per-scope log level overrides */
  scopes: z.record(z.string(), LogLevelSchema).optional(),
});

/**
 * Core Flowlib configuration schema
 */
export const FlowlibConfigSchema = z.object({
  database: databaseConfigSchema,
  /**
   * AES-256-GCM encryption key for credential storage (base64-encoded, 32 bytes).
   *
   * Generate with: `npx flowlib-cli secret`
   */
  encryptionKey: z
    .string()
    .min(1, 'encryptionKey is required. Generate one with: npx flowlib-cli secret'),
  logging: LoggingConfigSchema.default(() => ({
    level: 'info' as const,
  })).optional(),
  logger: z.any().optional(),
  /**
   * The path where the Flowlib frontend UI is mounted.
   * @example '/flowlib'
   */
  frontendPath: z.string().optional(),
  /**
   * The path where the Flowlib API is mounted.
   * Used by the frontend to make API requests.
   * @example '/api/flowlib'
   */
  apiPath: z.string().optional(),

  /**
   * UI theme mode.
   * - `'light'` — Light theme
   * - `'dark'`  — Dark theme
   * - `'system'` — Follow OS preference
   * @default 'dark'
   */
  theme: z.enum(['light', 'dark', 'system']).default('dark').optional(),

  /**
   * Execution settings: flow timeout, heartbeat interval, stale run detection.
   */
  execution: ExecutionConfigSchema.optional(),

  /**
   * Skip database initialization and connection.
   *
   * When `true`, `createFlowlib()` throws a `DatabaseError` with reason
   * `build_time_skip` before attempting to connect to the database. The host
   * (e.g. a framework adapter or build script) is responsible for setting this
   * flag — core does NOT sniff `process.env.NEXT_PHASE` / `VERCEL_ENV` / `CI`
   * to detect build-time, since those checks break on edge runtimes that
   * don't expose `process` (Cloudflare Workers, Deno Deploy, etc.).
   *
   * The Next.js adapter (`@flowlib/nextjs`) sets this automatically when it
   * detects `process.env.NEXT_PHASE === 'phase-production-build'`.
   *
   * @default false
   */
  skipDatabaseInit: z.boolean().optional(),

  /**
   * Trigger system configuration.
   * Controls webhook and cron scheduler behavior.
   */
  triggers: z
    .object({
      /**
       * The public-facing base URL where Flowlib routes are mounted.
       * Used to display the full webhook URL in the flow editor.
       * Example: "https://api.myapp.com/flowlib"
       */
      webhookBaseUrl: z.string().optional(),
      /**
       * Enable/disable the cron scheduler. When disabled, cron trigger nodes
       * can still be placed on flows but won't fire automatically.
       * @default true
       */
      cronEnabled: z.boolean().default(true),
    })
    .optional(),

  /**
   * Plugins extend Flowlib with additional capabilities:
   * actions, hooks, endpoints, database schema, frontend UI, and middleware.
   *
   * Each plugin is an `FlowlibPluginDefinition` with `{ id, backend?, frontend? }`.
   * Use plugin factory functions which accept a `frontend` option for the UI.
   *
   * The backend extracts `.backend`, the `<Flowlib>` component extracts `.frontend`.
   *
   * @example
   * ```typescript
   * import { auth } from '@flowlib/user-auth';
   * import { authFrontend } from '@flowlib/user-auth/ui';
   * import { rbac } from '@flowlib/rbac';
   *
   * const config = defineConfig({
   *   plugins: [
   *     auth({ frontend: authFrontend, adminEmail: '...' }),
   *     rbac(),
   *   ],
   * });
   * ```
   */
  plugins: z.array(z.any()).optional(),

  /**
   * Pluggable adapter overrides for cross-cutting infrastructure services.
   *
   * Each field replaces the corresponding default in-process implementation
   * inside `ServiceFactory.initialize()`. Omit any field (or omit the whole
   * `services` block) to keep the built-in defaults — self-hosted users
   * never need to touch this surface.
   *
   * Hosted/edge runtimes (Cloudflare Workers, Vercel Workflows, etc.) use
   * this to inject runtime-native implementations: DO-backed event buses,
   * KV-backed chat sessions, no-op cron schedulers (because Cloudflare
   * Cron Triggers handle scheduling externally), and so on.
   *
   * The full adapter contracts live in
   * [src/types/services.ts](../types/services.ts). Each field is stored
   * as `z.unknown()` because adapter instances are runtime objects and
   * not Zod-validatable.
   *
   * See `FlowlibServiceOverrides` for the typed shape of this object.
   */
  services: z
    .object({
      encryption: z.unknown().optional(),
      eventBus: z.unknown().optional(),
      chatSessionStore: z.unknown().optional(),
      cronScheduler: z.unknown().optional(),
      batchPoller: z.unknown().optional(),
      jobRunner: z.unknown().optional(),
    })
    .optional(),

  /**
   * Default credentials to ensure on startup.
   *
   * Each entry is created if no credential with the same `name` already exists.
   * Useful for development environments where you want API keys and OAuth
   * tokens available immediately without running a separate seed script.
   *
   * @example
   * ```typescript
   * const config = {
   *   defaultCredentials: [
   *     {
   *       name: 'Anthropic API Key',
   *       type: 'http-api',
   *       authType: 'bearer',
   *       config: { token: process.env.SEED_ANTHROPIC_API_KEY! },
   *       description: 'Seeded Anthropic credential',
   *     },
   *   ],
   * };
   * ```
   */
  defaultCredentials: z
    .array(
      z.discriminatedUnion('type', [
        // LLM credentials require a provider
        z.object({
          name: z.string(),
          type: z.literal('llm'),
          provider: z.string(),
          authType: z.string(),
          config: z.record(z.string(), z.unknown()),
          description: z.string().optional(),
          isShared: z.boolean().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
        // Non-LLM credentials have an optional provider
        z.object({
          name: z.string(),
          type: z.literal('http-api'),
          provider: z.string().optional(),
          authType: z.string(),
          config: z.record(z.string(), z.unknown()),
          description: z.string().optional(),
          isShared: z.boolean().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
        z.object({
          name: z.string(),
          type: z.literal('database'),
          provider: z.string().optional(),
          authType: z.string(),
          config: z.record(z.string(), z.unknown()),
          description: z.string().optional(),
          isShared: z.boolean().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      ]),
    )
    .optional(),
});

/**
 * Type inference from schemas
 */
export type ExecutionConfig = z.input<typeof ExecutionConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

import type { FlowlibServiceOverrides } from '../types/services';

/**
 * Inferred Flowlib configuration type.
 *
 * The `services` field is overridden from `unknown` (Zod) to the typed
 * `FlowlibServiceOverrides` shape so authors get proper IntelliSense for
 * `config.services.encryption`, etc. The runtime schema accepts any
 * object — the overrides are just adapter instances and not
 * Zod-validatable.
 */
export type FlowlibConfig = Omit<z.input<typeof FlowlibConfigSchema>, 'services'> & {
  services?: FlowlibServiceOverrides;
};

/**
 * Identity function that provides TypeScript type inference and
 * autocompletion for Flowlib configuration objects.
 *
 * No runtime validation, transformation, or side effects — same pattern
 * as Vite's `defineConfig`, Drizzle's `defineConfig`, etc.
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@flowlib/core';
 *
 * export default defineConfig({
 *   database: {
 *     type: 'sqlite',
 *     connectionString: 'file:./dev.db',
 *   },
 * });
 * ```
 */
export function defineConfig(config: FlowlibConfig): FlowlibConfig {
  return config;
}

/**
 * Identity function that provides TypeScript type inference for
 * unified plugin definitions with backend + frontend parts.
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@flowlib/core';
 *
 * export const myPlugin = definePlugin({
 *   id: 'my-plugin',
 *   backend: backendPlugin,
 *   frontend: frontendPlugin,
 * });
 * ```
 */
export function definePlugin<T extends { id: string; backend?: unknown; frontend?: unknown }>(
  plugin: T,
): T {
  return plugin;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
