/**
 * Flowlib Plugin System
 *
 * Plugins extend Flowlib with new capabilities: actions (nodes/tools),
 * lifecycle hooks, API endpoints, database schema, and middleware.
 *
 * Inspired by better-auth's plugin architecture, adapted for Flowlib's
 * framework-adapter pattern and action-based node system.
 *
 * @example
 * ```typescript
 * import { Flowlib } from '@flowlib/core';
 * import { rbac } from '@flowlib/plugin-rbac';
 * import { auditLog } from '@flowlib/plugin-audit-log';
 *
 * const flowlib = new Flowlib({
 *   plugins: [
 *     rbac({ resolveUser: (req) => req.user }),
 *     auditLog({ destination: 'database' }),
 *   ],
 * });
 * ```
 */

import type { ActionDefinition } from '@flowlib/action-kit';
import type { SQL } from 'drizzle-orm';
import type { Kysely } from 'kysely';
import type { FlowlibInstance } from 'src/api/types';
import type {
  FlowlibIdentity,
  FlowlibPermission,
  AuthorizationResult,
  AuthorizationContext,
} from './auth.types';

// =============================================================================
// Plugin Schema Types (Abstract, database-agnostic)
//
// Canonical definitions live in `@flowlib/db`. Imported here only so
// `FlowlibPlugin.schema` can be typed; not re-exported. Plugin authors
// import them directly:
//   `import type { FlowlibPluginSchema } from '@flowlib/db'`
// =============================================================================

import type { FlowlibPluginSchema } from '@flowlib/db';

// =============================================================================
// Plugin Endpoint Types
// =============================================================================

/**
 * An API endpoint defined by a plugin.
 *
 * Framework adapters (Express, Next.js, NestJS) mount these automatically.
 * The handler receives a framework-agnostic request/response interface.
 */
export interface FlowlibPluginEndpoint {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /**
   * Path relative to the Flowlib base path.
   * Supports Express-style params: `/my-plugin/items/:id`
   */
  path: string;

  /**
   * The handler function.
   * Receives parsed body/params/query and the Flowlib core instance.
   * Must return a serializable response.
   */
  handler: (context: PluginEndpointContext) => Promise<PluginEndpointResponse>;

  /**
   * Required permission to access this endpoint.
   * If set, the framework adapter enforces authorization before calling the handler.
   */
  permission?: FlowlibPermission;

  /**
   * If true, this endpoint does not require authentication.
   * @default false
   */
  isPublic?: boolean;
}

/**
 * Narrow API surface exposed to plugin endpoint handlers.
 *
 * This gives plugins access to core functionality (auth, flow access, etc.)
 * without coupling them to the full Flowlib class. Framework adapters
 * populate this from their core instance.
 */
export interface PluginEndpointCoreApi {
  /** Get all permissions for an identity (based on role) */
  getPermissions(identity: FlowlibIdentity | null): FlowlibPermission[];
  /** Get available roles and their permission definitions */
  getAvailableRoles(): Array<{ role: string; permissions: FlowlibPermission[] }>;
  /** Get the resolved role string for an identity */
  getResolvedRole(identity: FlowlibIdentity): string | null;
  /** Authorize an action for an identity */
  authorize(context: AuthorizationContext): Promise<AuthorizationResult>;
}

/**
 * Narrow database API exposed to plugin endpoint handlers.
 *
 * Plugins should use this instead of reaching into framework-specific
 * database clients directly. It keeps plugin code portable across the
 * supported host database types while still allowing schema-owning plugins
 * to persist their own records.
 */
export interface PluginDatabaseApi {
  /** Host database dialect */
  type: 'postgresql' | 'sqlite' | 'mysql';

  /** Execute a query and return result rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute a statement where no result rows are needed */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /**
   * Execute a Drizzle `sql\`\`` template and return rows.
   *
   * Routes through the dialect's `sqlToQuery` compiler, then through the
   * unified driver layer — so the same `SQL` expression works on SQLite
   * (`.all()` semantics), Postgres, and MySQL without callers branching
   * on `db.type`.
   *
   * @deprecated Phase-2: prefer `kysely<DB>()` for new plugin code. Kysely's
   * typed `sql<T>\`\``.execute(db)\` covers the same dialect-portable raw-SQL
   * cases this method was designed for, with end-to-end type checking on the
   * result rows. `executeRows` is retained as a legacy escape hatch.
   */
  executeRows<T = Record<string, unknown>>(query: SQL): Promise<T[]>;

  /**
   * Typed Drizzle DB handle for plugins that ship per-dialect Drizzle
   * tables. Typed loosely as `unknown` because the concrete shape is
   * dialect-specific (`DrizzleD1Database` / `NodePgDatabase` /
   * `MySql2Database`); plugins narrow via `db.type` and cast to the
   * Drizzle base type they need.
   *
   * Example:
   *   if (db.type === 'sqlite') {
   *     const drizzleDb = db.drizzle as BaseSQLiteDatabase<'async', any>;
   *     await drizzleDb.select().from(myTable);
   *   }
   *
   * Plugins that don't need Drizzle (or don't ship per-dialect tables)
   * can keep using `query()` / `execute()` for portable raw SQL.
   *
   * @deprecated Phase-2: prefer `kysely<DB>()` for new plugin code. The
   * Drizzle handle stays for compatibility with existing per-dialect
   * tables; new plugins should declare a typed `DB` interface and use
   * Kysely instead.
   */
  drizzle: unknown;

  /**
   * Typed Kysely query-builder handle. Plugin supplies its own `DB`
   * interface (an intersection of `CoreDB` from `@flowlib/db/kysely`,
   * any other plugin's published table interfaces it joins against,
   * and the plugin's own owned-tables interface).
   *
   * One typed expression works across SQLite/Postgres/MySQL — no
   * dialect triplication, full column-level type checking. This is
   * the recommended path for plugin queries; `executeRows()` and
   * `drizzle` remain as legacy escape hatches.
   *
   * Example:
   *   import type { CoreDB } from '@flowlib/db/kysely';
   *   import type { RbacDB } from './db-types';
   *
   *   const k = ctx.database.kysely<CoreDB & RbacDB>();
   *   const rows = await k
   *     .selectFrom('flowlib_rbac_team_members')
   *     .where('user_id', '=', userId)
   *     .select('team_id')
   *     .execute();
   */
  kysely<DB>(): Kysely<DB>;
}

/**
 * Context passed to plugin endpoint handlers.
 */
export interface PluginEndpointContext {
  /** Parsed request body (for POST/PUT/PATCH) */
  body: Record<string, unknown>;
  /** URL path parameters (e.g., { id: '123' }) */
  params: Record<string, string>;
  /** URL query parameters */
  query: Record<string, string | undefined>;
  /** Request headers */
  headers: Record<string, string | undefined>;
  /** Resolved identity (null if unauthenticated or public route) */
  identity: FlowlibIdentity | null;
  /** Database API for plugin-owned tables */
  database: PluginDatabaseApi;
  /** The raw Request object (Web API Request) */
  request: Request;
  /**
   * Core API — provides access to auth, flow access, and authorization
   * services. Populated by the framework adapter.
   */
  core: PluginEndpointCoreApi;

  /**
   * Access the full Flowlib instance for advanced operations.
   *
   * Use this when the narrow `core` API is insufficient — e.g., for
   * reading flows, executing runs, accessing credentials, etc.
   *
   * @example
   * ```typescript
   * const flowlib = ctx.getFlowlib();
   * const flows = await flowlib.flows.list();
   * ```
   */
  getFlowlib: () => FlowlibInstance;
}

/**
 * Response from a plugin endpoint handler.
 */
export type PluginEndpointResponse =
  | { status?: number; body: unknown } // JSON response
  | { status?: number; stream: ReadableStream } // Streaming response (SSE, etc.)
  | Response; // Raw Web API Response

// =============================================================================
// Plugin Hook Types
// =============================================================================

/**
 * Context for flow run lifecycle hooks.
 */
export interface FlowRunHookContext {
  /** The flow ID being executed */
  flowId: string;
  /** The flow run ID */
  flowRunId: string;
  /** The flow version number */
  flowVersion: number;
  /** Input data for the flow run */
  inputs: Record<string, unknown>;
  /** Identity of the user who triggered the run (if available) */
  identity?: FlowlibIdentity | null;
}

/**
 * Context for node execution lifecycle hooks.
 */
export interface NodeExecutionHookContext {
  /** The flow run context */
  flowRun: FlowRunHookContext;
  /** The node ID being executed */
  nodeId: string;
  /** The node type (action ID or "AGENT") */
  nodeType: string;
  /** The node's label */
  nodeLabel?: string;
  /** Input data for this node */
  inputs: Record<string, unknown>;
  /** Resolved config params for this node */
  params: Record<string, unknown>;
}

/**
 * Result from an afterNodeExecute hook.
 */
export interface NodeExecutionHookResult {
  /** Optionally override the node output */
  output?: unknown;
}

/**
 * Plugin hooks for intercepting Flowlib lifecycle events.
 *
 * Hooks run in plugin array order. A hook returning `{ cancel: true }`
 * short-circuits the operation (remaining plugins are skipped).
 */
export interface FlowlibPluginHooks {
  /**
   * Runs before a flow execution starts.
   * Return `{ cancel: true, reason: '...' }` to prevent the run.
   * Return `{ inputs: {...} }` to modify the inputs.
   */
  beforeFlowRun?: (
    context: FlowRunHookContext,
  ) => Promise<void | { cancel?: boolean; reason?: string; inputs?: Record<string, unknown> }>;

  /**
   * Runs after a flow execution completes (success or failure).
   */
  afterFlowRun?: (
    context: FlowRunHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      outputs?: Record<string, unknown>;
      error?: string;
      duration?: number;
    },
  ) => Promise<void>;

  /**
   * Runs before each node executes.
   * Return `{ skip: true }` to skip this node.
   * Return `{ params: {...} }` to override resolved params.
   */
  beforeNodeExecute?: (
    context: NodeExecutionHookContext,
  ) => Promise<void | { skip?: boolean; params?: Record<string, unknown> }>;

  /**
   * Runs after each node executes.
   * Return `{ output: ... }` to override the node's output.
   */
  afterNodeExecute?: (
    context: NodeExecutionHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      output?: unknown;
      error?: string;
      errorDetails?: import('@flowlib/action-kit').NodeErrorDetails;
      duration?: number;
    },
  ) => Promise<void | NodeExecutionHookResult>;

  /**
   * Runs after a `core.agent` node completes its prompt-tool-iterate loop.
   *
   * Fires once per agent node — NOT per internal tool call. Carries the
   * aggregate cost (token totals, tool call count) so hosts can meter
   * agent activity without instrumenting every tool dispatch.
   *
   * Distinct from `afterNodeExecute` because the agent records token
   * usage in `result.metadata.tokenUsage` which is not visible to the
   * generic node hook signature.
   */
  afterAgentExecute?: (context: {
    flowRunId: string;
    flowId: string;
    nodeId: string;
    /** Resolved model id used for the agent's primary loop. */
    model?: string;
    tokensIn: number;
    tokensOut: number;
    /** Number of tool invocations the agent made during the loop. */
    toolCallCount: number;
    /** Total wall-clock duration of the agent node in ms. */
    durationMs: number;
  }) => Promise<void>;

  /**
   * Runs after every individual tool invocation inside a `core.agent` loop.
   *
   * Fires once per tool call (not per agent node). Use this to bill
   * per-call cost — e.g. counting `agentToolInvocations` against an org
   * quota the moment each call lands, rather than waiting for the whole
   * agent loop to finish via `afterAgentExecute`. Long-running agents
   * with many tool calls would otherwise let cost accrue invisibly until
   * the loop returns.
   *
   * Errors thrown by this hook are caught and logged at warn level —
   * they do not interrupt the agent loop.
   */
  afterAgentToolExecute?: (context: {
    flowRunId: string;
    flowId: string;
    /** ID of the parent `core.agent` node. */
    nodeId: string;
    /** Stable agent-tool ID (`core.agent_tool` configured-instance id). */
    toolId: string;
    /** Display name of the tool (configured `name` or registered `name`). */
    toolName: string;
    /** Iteration number within the agent loop (1-indexed). */
    iteration: number;
    /** Whether the tool returned a successful result. */
    success: boolean;
    /** Error message if the tool failed (timeout, action error, validation). */
    error?: string;
    /** Wall-clock duration of the tool call in ms. */
    durationMs: number;
  }) => Promise<void>;

  /**
   * Runs before every API request (in framework adapters).
   * Return a Response to short-circuit (like better-auth's onRequest).
   * Return `{ request }` to modify the request.
   */
  onRequest?: (
    request: Request,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ) => Promise<void | { response: Response } | { request: Request }>;

  /**
   * Runs after every API response (in framework adapters).
   * Return a Response to replace the original response.
   */
  onResponse?: (
    response: Response,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ) => Promise<void | { response: Response }>;

  /**
   * Runs during authorization checks.
   * Return `{ allowed: true/false }` to override the default RBAC result.
   * Return void to use the default authorization logic.
   */
  onAuthorize?: (context: {
    identity: FlowlibIdentity | null;
    action: FlowlibPermission;
    resource?: { type: string; id?: string };
    database?: PluginDatabaseApi;
  }) => Promise<void | AuthorizationResult>;
}

// =============================================================================
// Plugin Context (passed to init)
// =============================================================================

/**
 * Context provided to a plugin's `init()` function.
 *
 * Gives plugins access to Flowlib's internals for deep integration.
 */
export interface FlowlibPluginContext {
  /**
   * The full Flowlib configuration (read-only).
   * Plugins can read config but not modify it after init.
   */
  config: Record<string, unknown>;

  /** Logger instance for the plugin */
  logger: {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };

  /**
   * Check if another plugin is registered.
   *
   * @example
   * ```typescript
   * if (ctx.hasPlugin('rbac')) {
   *   // RBAC plugin is active, can rely on identity being resolved
   * }
   * ```
   */
  hasPlugin: (pluginId: string) => boolean;

  /**
   * Get another registered plugin by ID.
   * Returns null if the plugin is not registered.
   */
  getPlugin: (pluginId: string) => FlowlibPlugin | null;

  /**
   * Register additional actions at init time.
   * Equivalent to calling `flowlib.registerAction()` for each action.
   */
  registerAction: (action: ActionDefinition) => void;

  /**
   * Store plugin-specific data accessible to other plugins and hooks.
   * This is a simple key-value store scoped to the plugin.
   */
  store: Map<string, unknown>;

  /**
   * Access the full Flowlib instance.
   *
   * Available only after core initialization completes. Use for advanced
   * operations that go beyond the basic plugin context (e.g., executing
   * flows, accessing credentials, running tests).
   *
   * **Note:** This is a lazy accessor. The instance is not available during
   * `init()` if called before `Flowlib.initialize()` finishes building
   * the service layer. For init-time operations, use `registerAction`,
   * `hasPlugin`, and `store` instead.
   */
  getFlowlib: () => FlowlibInstance;
}

// =============================================================================
// Plugin Init Result
// =============================================================================

/**
 * Optional return value from `init()`.
 * Allows plugins to modify Flowlib's configuration or provide additional context.
 */
export interface FlowlibPluginInitResult {
  /**
   * Additional options to merge into the Flowlib config.
   * Shallow-merged with the existing config. Cannot override core fields.
   */
  options?: Record<string, unknown>;

  /**
   * Additional context to merge into the plugin context.
   * Available to other plugins via `ctx.store`.
   */
  context?: Record<string, unknown>;
}

// =============================================================================
// Main Plugin Interface
// =============================================================================

/**
 * The Flowlib Plugin interface.
 *
 * Only `id` is required. All other properties are optional and enable
 * specific extension capabilities.
 *
 * @example
 * ```typescript
 * import type { FlowlibPlugin } from '@flowlib/core';
 *
 * export function myPlugin(options?: MyPluginOptions): FlowlibPlugin {
 *   return {
 *     id: 'my-plugin',
 *
 *     schema: {
 *       auditLogs: {
 *         fields: {
 *           id: { type: 'uuid', primaryKey: true, defaultValue: 'uuid()' },
 *           action: { type: 'string', required: true },
 *           createdAt: { type: 'date', defaultValue: 'now()' },
 *         },
 *       },
 *     },
 *
 *     actions: [myCustomAction],
 *
 *     endpoints: [{
 *       method: 'GET',
 *       path: '/my-plugin/stats',
 *       handler: async (ctx) => ({ body: { count: 42 } }),
 *     }],
 *
 *     hooks: {
 *       afterFlowRun: async (context) => {
 *         console.log(`Flow ${context.flowId} completed with ${context.status}`);
 *       },
 *     },
 *
 *     async init(ctx) {
 *       ctx.logger.info('My plugin initialized');
 *     },
 *
 *     async shutdown() {
 *       // cleanup
 *     },
 *   };
 * }
 * ```
 */
export interface FlowlibPlugin {
  /**
   * Unique plugin identifier.
   * Used for `hasPlugin()` / `getPlugin()` lookups and logging.
   */
  id: string;

  /**
   * Human-readable plugin name (for logging and diagnostics).
   */
  name?: string;

  /**
   * Called during `Flowlib.initialize()`, after the action registry is created
   * but before the service factory is built.
   *
   * Use this to:
   * - Register actions dynamically
   * - Set up plugin-internal state
   * - Read configuration from other plugins
   * - Validate plugin prerequisites
   */
  init?: (
    context: FlowlibPluginContext,
  ) => Promise<FlowlibPluginInitResult | void> | FlowlibPluginInitResult | void;

  /**
   * Database schema required by this plugin.
   *
   * Declared using the abstract `FlowlibPluginSchema` format.
   * The Flowlib CLI generates the concrete Drizzle schema files
   * from core + plugin schemas combined.
   *
   * Run `npx flowlib-cli generate` after adding/changing plugin schemas.
   */
  schema?: FlowlibPluginSchema;

  /**
   * Table names that this plugin requires to exist in the database.
   *
   * Used during startup to verify that all required tables are present.
   * If any are missing, Flowlib logs a clear, developer-friendly error
   * explaining which plugin needs which tables and how to fix it.
   *
   * This is separate from `schema` — use `requiredTables` when your plugin
   * relies on tables that are managed externally (e.g., better-auth creates
   * its own tables) or when you want a lightweight existence check without
   * needing to declare a full abstract schema.
   *
   * If `schema` is declared and `requiredTables` is not, the table names
   * from `schema` are used automatically.
   *
   * @example
   * ```typescript
   * // Plugin that relies on better-auth's tables
   * requiredTables: ['user', 'session', 'account', 'verification']
   *
   * // Plugin that declares its own schema (requiredTables inferred)
   * schema: { auditLogs: { tableName: 'audit_logs', fields: { ... } } }
   * ```
   */
  requiredTables?: string[];

  /**
   * Actions (nodes + agent tools) provided by this plugin.
   *
   * These are registered into the ActionRegistry during initialization,
   * making them available as flow nodes and agent tools.
   */
  actions?: ActionDefinition[];

  /**
   * API endpoints provided by this plugin.
   *
   * Framework adapters (Express, Next.js, NestJS) automatically mount
   * these alongside the core Flowlib routes.
   */
  endpoints?: FlowlibPluginEndpoint[];

  /**
   * Lifecycle hooks for intercepting flow execution, API requests,
   * and authorization.
   */
  hooks?: FlowlibPluginHooks;

  /**
   * Human-readable setup instructions shown when required tables are missing.
   * Overrides the default generic Drizzle instructions.
   *
   * @example
   * ```typescript
   * setupInstructions: 'Run `pnpm db:push` to create the better-auth tables.'
   * ```
   */
  setupInstructions?: string;

  /**
   * Error codes returned by this plugin.
   * Merged into the global error code registry.
   */
  $ERROR_CODES?: Record<string, { message: string; status?: number }>;

  /**
   * Called during `Flowlib.shutdown()`.
   * Clean up connections, timers, or other resources.
   */
  shutdown?: () => Promise<void> | void;
}

// =============================================================================
// Unified Plugin Definition
// =============================================================================

/**
 * A unified plugin definition that bundles both backend and frontend parts.
 *
 * Returned by plugin factory functions and passed to `defineConfig({ plugins: [...] })`.
 * The backend extracts `.backend`, the `<Flowlib>` component extracts `.frontend`.
 *
 * @example
 * ```typescript
 * import { auth } from '@flowlib/user-auth';
 * import { authFrontend } from '@flowlib/user-auth/ui';
 *
 * export const config = defineConfig({
 *   plugins: [
 *     auth({ frontend: authFrontend, adminEmail: '...' }),
 *   ],
 * });
 * ```
 */
export interface FlowlibPluginDefinition {
  /** Unique plugin identifier */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Backend plugin (hooks, endpoints, schema, actions) */
  backend?: FlowlibPlugin;
  /** Frontend plugin (sidebar, routes, providers, components). Typed as `unknown` to avoid React dependency in core. */
  frontend?: unknown;
}

// =============================================================================
// Plugin Hook Runner (internal utility)
// =============================================================================

/**
 * Collects and executes hooks from all registered plugins.
 * Used internally by `Flowlib` and framework adapters.
 */
export interface PluginHookRunner {
  /** Run all beforeFlowRun hooks in order */
  runBeforeFlowRun: (
    context: FlowRunHookContext,
  ) => Promise<{ cancelled: boolean; reason?: string; inputs?: Record<string, unknown> }>;

  /** Run all afterFlowRun hooks in order */
  runAfterFlowRun: (
    context: FlowRunHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
      outputs?: Record<string, unknown>;
      error?: string;
      duration?: number;
    },
  ) => Promise<void>;

  /** Run all beforeNodeExecute hooks in order */
  runBeforeNodeExecute: (
    context: NodeExecutionHookContext,
  ) => Promise<{ skipped: boolean; params?: Record<string, unknown> }>;

  /** Run all afterNodeExecute hooks in order */
  runAfterNodeExecute: (
    context: NodeExecutionHookContext & {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      output?: unknown;
      error?: string;
      errorDetails?: import('@flowlib/action-kit').NodeErrorDetails;
      duration?: number;
    },
  ) => Promise<{ output?: unknown }>;

  /** Run all afterAgentExecute hooks in order */
  runAfterAgentExecute: (context: {
    flowRunId: string;
    flowId: string;
    nodeId: string;
    model?: string;
    tokensIn: number;
    tokensOut: number;
    toolCallCount: number;
    durationMs: number;
  }) => Promise<void>;

  /** Run all afterAgentToolExecute hooks in order */
  runAfterAgentToolExecute: (context: {
    flowRunId: string;
    flowId: string;
    nodeId: string;
    toolId: string;
    toolName: string;
    iteration: number;
    success: boolean;
    error?: string;
    durationMs: number;
  }) => Promise<void>;

  /** Run all onRequest hooks in order */
  runOnRequest: (
    request: Request,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ) => Promise<{ intercepted: boolean; response?: Response; request?: Request }>;

  /** Run all onResponse hooks in order */
  runOnResponse: (
    response: Response,
    context: { path: string; method: string; identity: FlowlibIdentity | null },
  ) => Promise<Response>;

  /** Run all onAuthorize hooks in order */
  runOnAuthorize: (context: {
    identity: FlowlibIdentity | null;
    action: FlowlibPermission;
    resource?: { type: string; id?: string };
    database?: PluginDatabaseApi;
  }) => Promise<AuthorizationResult | null>;
}
