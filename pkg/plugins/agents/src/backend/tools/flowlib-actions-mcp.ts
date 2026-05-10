/**
 * Flowlib-actions MCP bridge — Stream G.
 *
 * Exposes every action in `@flowlib/actions`'s `ActionRegistry` as an
 * MCP tool, so MCP-speaking agents (Claude Code, opencode, raw-LLM via
 * adapter) can call them just like any other built-in tool.
 *
 * **Why we use the low-level `Server`, not `McpServer`.** The high-level
 * `McpServer.registerTool` API expects either a Zod raw shape or a Zod
 * schema for `inputSchema`. We already have a JSON Schema (built by the
 * registry's `toAgentToolDefinition()` helper or via the action's Zod
 * `params.schema`), so converting back-and-forth is wasteful and loses
 * fidelity. Using `Server.setRequestHandler(ListToolsRequestSchema, …)`
 * lets us emit the raw JSON Schema unchanged.
 *
 * **Hot-reload.** P0 added `ActionRegistry.onRegister` /
 * `ActionRegistry.onUnregister`. We subscribe in this factory and
 * rebuild the in-memory tool list on each event, then call
 * `server.sendToolListChanged()` so connected MCP clients re-list on
 * the next interaction. Confirmed signatures (see
 * `pkg/actions/src/registry/index.ts`):
 *
 * ```ts
 * onRegister(listener: (action: ActionDefinition) => void): () => void
 * onUnregister(listener: (actionId: string) => void): () => void
 * ```
 *
 * Both return an unsubscribe function the caller should invoke during
 * shutdown to avoid leaks.
 *
 * **Filter.** v1 filters that mirror the existing
 * `ActionRegistry.toAgentToolDefinition()` rules:
 *
 * 1. `excludeFromTools === true` — author-tagged "flow-only" actions.
 *    (Action-kit doesn't have `agentToolCompatible`; the brief used a
 *    forward-looking name, but the registry uses `excludeFromTools`.
 *    Documented as a finding in the report.)
 * 2. Triggers (`provider.id === 'triggers'` or `id.startsWith('trigger.')`).
 * 3. The `permissions.getEffectiveDenyList()` set.
 * 4. Optional credential capability check — when `actionRequiresCredential`
 *    and the user has none, the action is filtered at list time.
 *
 * Tool name flattens `.` → `_` (`gmail.send_message` →
 * `gmail_send_message`); collisions are resolved by suffixing `_<n>`
 * and a `warn` log so operators can fix the underlying ids.
 *
 * **Execution.** Tool calls route through `executeActionAsTool` from
 * `@flowlib/actions`. The bridge constructs a minimal
 * `AgentToolExecutionContext` for the call; the Stream A run loop hands
 * us the per-turn pieces (logger, abort signal, iteration count) at
 * call time via the `onCallTool` hook.
 *
 * **Tool-output truncation.** When a `toolOutputStore` is supplied, the
 * bridge runs the textual representation of the action result through
 * `toolOutputStore.truncate({ toolCallId, output, budget })` before
 * shipping it to the model. The full output stays inside the
 * workspace's `.flowlib/tool-outputs/` directory.
 */

import type {
  ActionDefinition,
  AgentToolExecutionContext,
  AgentToolResult,
  Logger,
  NodeExecutionContext,
} from '@flowlib/action-kit';
import type { ActionRegistry } from '@flowlib/actions/registry';
import { executeActionAsTool } from '@flowlib/actions';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { PermissionsResolver } from '../permissions/types';
import type { WorkspaceHandle } from '../workspaces/types';
import type { ToolOutputStore, ToolOutputBudget } from './tool-output-store';

// ─── Workspace-less fallback tool ───────────────────────────────────────

/**
 * Name of the built-in MCP tool the bridge registers when no workspace
 * is attached. Mirrors `tools-and-mcp.md`'s `read_tool_output` spec —
 * the agent uses this to fetch slices of a previously-truncated tool
 * result that was stored in the session blob (DO storage in production,
 * the in-memory map inside `ToolOutputStore` for v1).
 */
export const READ_TOOL_OUTPUT_TOOL_NAME = 'read_tool_output';

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * Minimum interface needed from a `CredentialsAPI`-shaped object. We
 * keep this loose so callers can pass `flowlib.credentials` directly or
 * a hand-built mock without dragging the full type surface in.
 */
export interface CredentialsLister {
  list(filters?: { type?: string }): Promise<Array<{ id: string; type?: string }>>;
}

/**
 * Per-call hooks so Stream A can supply the runtime pieces we don't
 * own (logger, abort signal, iteration counter). Keeps the bridge
 * stateless across turns; one bridge instance can serve many calls.
 */
export interface CallToolHooks {
  /**
   * Build the `nodeContext` passed to `executeActionAsTool`. Stream A's
   * agent loop usually has a half-built `NodeExecutionContext` cached on
   * the session; we pull what we need at call time.
   */
  buildNodeContext(): NodeExecutionContext;
  /** Optional iteration counter for `AgentToolExecutionContext`. */
  iteration?: number;
  /** Maps to `AgentToolExecutionContext.maxIterations`. */
  maxIterations?: number;
  /** Per-call abort signal. */
  abortSignal?: AbortSignal;
  /** Static params merged into the model-supplied input (e.g. `credentialId`). */
  staticParams?: Record<string, unknown>;
  /** Per-call output budget override. */
  budget?: Partial<ToolOutputBudget>;
}

/** Factory options. */
export interface CreateFlowlibActionsMcpServerOptions {
  registry: ActionRegistry;
  /** Caller's user id — kept for audit / credential filtering. */
  userId: string;
  /** Session id — used as the MCP server's "instance" label. */
  sessionId: string;
  /** Permission resolver from Stream J. Required; pass `allowAllResolver` if you need a no-op. */
  permissions: PermissionsResolver;
  /**
   * Workspace handle from Stream E. **Optional** — when absent, the
   * bridge registers the `read_tool_output` MCP tool so workspace-less
   * agents can still query truncated outputs. When present, large tool
   * outputs are written to `.flowlib/tool-outputs/<toolCallId>.txt`
   * inside the workspace and the agent uses provider-native Grep / Read
   * to query them.
   */
  workspace?: WorkspaceHandle;
  /**
   * Optional credentials API. When supplied, actions with
   * `credential.required === true` are filtered out of `tools/list` if
   * the user has zero credentials of the required type. Lazy-resolved
   * once per `tools/list`; the brief leans toward "tool-list time" over
   * "tool-call time" to avoid wasted model turns.
   */
  credentialsLister?: CredentialsLister;
  /** Tool-output store from Stream G. When omitted, outputs ship verbatim. */
  toolOutputStore?: ToolOutputStore;
  /** Hooks for tool calls — Stream A wires this. */
  callHooks?: CallToolHooks | (() => CallToolHooks);
  /** Logger; defaults to a no-op. */
  logger?: Logger;
  /** Authentication context fed to permission queries. Built by Stream A from `AgentsAuthContext`. */
  resolveDenyListInput?: () => Parameters<PermissionsResolver['getEffectiveDenyList']>[0];
  /** Override the MCP server name. */
  serverName?: string;
  /** Override the MCP server version. */
  serverVersion?: string;
}

/**
 * The return shape — wraps the underlying MCP `Server` plus a few extras
 * that callers (Stream A, INT) need.
 */
export interface FlowlibActionsMcpHandle {
  /** The MCP server. Hand to the provider's MCP wiring. */
  server: Server;
  /**
   * Force a tool-list rebuild + `notifications/tools/list_changed`
   * broadcast. Mostly used by tests; live updates fire automatically
   * via the registry events.
   */
  refresh(): Promise<void>;
  /** Snapshot of the current visible tool list. Mostly used by tests. */
  listTools(): Promise<Tool[]>;
  /**
   * Direct tool-call helper for tests / non-MCP callers. Bypasses the
   * MCP transport but goes through the same dispatch path so deny-list
   * + truncation behaviour matches.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  /** Tear down listeners + close the underlying server. Idempotent. */
  close(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────

const noopLog = (): void => undefined;
const DEFAULT_LOGGER: Logger = {
  debug: noopLog,
  info: noopLog,
  warn: noopLog,
  error: noopLog,
};

/**
 * Build an in-process MCP server that re-exposes every registered
 * Flowlib action as a tool. See file header for the contract.
 */
export function createFlowlibActionsMcpServer(
  opts: CreateFlowlibActionsMcpServerOptions,
): FlowlibActionsMcpHandle {
  const logger = opts.logger ?? DEFAULT_LOGGER;
  const registry = opts.registry;
  const permissions = opts.permissions;
  const workspace = opts.workspace;

  const server = new Server(
    {
      name: opts.serverName ?? 'flowlib-actions',
      version: opts.serverVersion ?? '0.1.0',
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    },
  );

  /**
   * Cached map of the visible tool list, keyed by the *flattened* tool
   * name (`gmail.send_message` → `gmail_send_message`). Rebuilt on
   * `onRegister` / `onUnregister` events and on each `tools/list` call
   * (so deny-list changes reflect without an explicit invalidation).
   */
  let visibleTools = new Map<string, VisibleTool>();
  let userCredentialTypes: Set<string> | null = null;
  let closed = false;

  // ─── Subscribe to registry events ────────────────────────────────
  const offRegister = registry.onRegister(() => {
    if (closed) {
      return;
    }
    // Cache becomes stale; clear it so the next list call rebuilds.
    visibleTools.clear();
    userCredentialTypes = null;
    notifyToolListChanged(server, logger).catch(() => {
      /* fully swallowed — already logged inside */
    });
  });
  const offUnregister = registry.onUnregister(() => {
    if (closed) {
      return;
    }
    visibleTools.clear();
    userCredentialTypes = null;
    notifyToolListChanged(server, logger).catch(() => {
      /* fully swallowed — already logged inside */
    });
  });

  /** True when the bridge needs to expose `read_tool_output`. */
  const needsReadToolOutputFallback = !workspace && !!opts.toolOutputStore;

  async function rebuildVisibleTools(): Promise<Map<string, VisibleTool>> {
    const denyResult = await safeResolveDenyList(permissions, opts.resolveDenyListInput, logger);
    if (denyResult.failClosed) {
      // Resolver threw — fail closed and surface zero tools. Better to
      // hide everything than silently expose denied ones.
      visibleTools = new Map();
      return visibleTools;
    }
    const denySet = denyResult.denied;
    const credentialFilter = await resolveCredentialFilter(
      registry,
      opts.credentialsLister,
      userCredentialTypes,
      logger,
    );
    userCredentialTypes = credentialFilter.userTypes;

    const next = new Map<string, VisibleTool>();
    const flattenedToOriginal = new Map<string, string>();

    for (const action of registry.getAll()) {
      if (!isToolCompatible(action)) {
        continue;
      }
      if (denySet.has(action.id)) {
        continue;
      }
      if (!credentialFilter.permits(action)) {
        continue;
      }

      const baseName = flattenActionId(action.id);
      const uniqueName = uniquifyName(baseName, flattenedToOriginal, action.id, logger);
      flattenedToOriginal.set(uniqueName, action.id);

      next.set(uniqueName, {
        toolName: uniqueName,
        actionId: action.id,
        action,
        descriptor: buildToolDescriptor(uniqueName, action),
      });
    }

    // Inject the workspace-less fallback. We never deny-filter this one
    // — it has no side effects beyond reading from the session-scoped
    // store, and if the agent doesn't see it the rest of the truncation
    // strategy falls apart.
    if (needsReadToolOutputFallback && !denySet.has(READ_TOOL_OUTPUT_TOOL_NAME)) {
      next.set(READ_TOOL_OUTPUT_TOOL_NAME, {
        toolName: READ_TOOL_OUTPUT_TOOL_NAME,
        actionId: READ_TOOL_OUTPUT_TOOL_NAME,
        action: undefined,
        descriptor: buildReadToolOutputDescriptor(),
      });
    }

    visibleTools = next;
    return next;
  }

  // ─── List tools handler ──────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await rebuildVisibleTools();
    return {
      tools: Array.from(tools.values()).map((t) => t.descriptor),
    };
  });

  // ─── Call tool handler ───────────────────────────────────────────
  async function dispatchCallTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (visibleTools.size === 0) {
      // Cold cache — populate before lookup.
      await rebuildVisibleTools();
    }

    let visible = visibleTools.get(name);
    if (!visible) {
      // Re-check the deny list — visible cache may be stale (e.g. an
      // action registered between two model turns).
      await rebuildVisibleTools();
      visible = visibleTools.get(name);
      if (!visible) {
        return errorResult(`Unknown or filtered tool: ${name}`);
      }
    }

    if (visible.toolName === READ_TOOL_OUTPUT_TOOL_NAME) {
      return executeReadToolOutput(args, opts.toolOutputStore, logger);
    }

    return executeOne(visible, args, opts, workspace, logger);
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return dispatchCallTool(name, args);
  });

  // ─── Handle ───────────────────────────────────────────────────────
  return {
    server,
    async refresh() {
      visibleTools.clear();
      userCredentialTypes = null;
      await rebuildVisibleTools();
      await notifyToolListChanged(server, logger);
    },
    async listTools() {
      const tools = await rebuildVisibleTools();
      return Array.from(tools.values()).map((t) => t.descriptor);
    },
    callTool: dispatchCallTool,
    async close() {
      closed = true;
      offRegister();
      offUnregister();
      try {
        await server.close();
      } catch (err) {
        logger.warn?.(
          `[flowlib-actions-mcp] error during close: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

// ─── Internals ──────────────────────────────────────────────────────────

interface VisibleTool {
  toolName: string;
  actionId: string;
  /** Undefined for built-in tools (e.g. `read_tool_output`). */
  action: ActionDefinition | undefined;
  descriptor: Tool;
}

/**
 * Whether an action should be exposed as an MCP tool. Mirrors
 * `ActionRegistry.toAgentToolDefinition()` filtering.
 */
function isToolCompatible(action: ActionDefinition): boolean {
  if (action.excludeFromTools === true) {
    return false;
  }
  if (action.provider?.id === 'triggers') {
    return false;
  }
  if (action.id.startsWith('trigger.')) {
    return false;
  }
  return true;
}

/** Flatten `gmail.send_message` → `gmail_send_message`. */
export function flattenActionId(id: string): string {
  // MCP requires names to match `[A-Za-z][A-Za-z0-9_-]*`. The action ids
  // in this codebase are alphanumeric + `.` + `_`, so flattening `.` to
  // `_` is sufficient. Defensive replacement for any other char too.
  return id.replace(/\./g, '_').replace(/[^A-Za-z0-9_-]/g, '_');
}

function uniquifyName(
  base: string,
  taken: Map<string, string>,
  newId: string,
  logger: Logger,
): string {
  if (!taken.has(base)) {
    return base;
  }

  // Same id collision shouldn't happen — the registry de-dups. But two
  // different action ids could flatten to the same name.
  const existingId = taken.get(base);
  if (existingId === newId) {
    return base;
  }

  let n = 1;
  let candidate = `${base}_${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  logger.warn?.(
    `[flowlib-actions-mcp] tool-name collision after flattening: ` +
      `actions "${existingId}" and "${newId}" both map to "${base}"; ` +
      `using "${candidate}" for the latter. Consider renaming one of the action ids.`,
  );
  return candidate;
}

/**
 * Build a JSON-Schema input from an action's params. Reuses the
 * registry's existing helper via `toAgentToolDefinition()` so the
 * schema shape matches what the legacy agent-tool path produces.
 */
function buildToolDescriptor(toolName: string, action: ActionDefinition): Tool {
  // The registry's helper converts the param fields into a JSON Schema
  // suitable for an LLM tool. It also strips `aiProvided: false` fields
  // (e.g. `credentialId` set by the platform).
  // We can't call it directly without the registry instance, so we
  // inline the same shape here.
  const inputSchema = buildJsonSchemaFromAction(action);

  return {
    name: toolName,
    description: action.description,
    inputSchema,
  } satisfies Tool;
}

/**
 * Build a JSON-schema-shaped input descriptor from an action's
 * `params.fields`. Mirrors `pkg/actions/src/registry/index.ts`'s
 * `buildJsonSchema()` (which is private to that module).
 */
function buildJsonSchemaFromAction(action: ActionDefinition): {
  type: 'object';
  properties: Record<string, object>;
  required?: string[];
} {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of action.params.fields) {
    if ((field as { aiProvided?: boolean }).aiProvided === false) {
      continue;
    }

    const prop: Record<string, unknown> = {
      description: field.description ?? field.label,
    };

    switch (field.type) {
      case 'number':
        prop.type = 'number';
        break;
      case 'boolean':
        prop.type = 'boolean';
        break;
      case 'json':
        prop.type = ['object', 'array', 'string'];
        break;
      default:
        prop.type = 'string';
    }
    if (field.placeholder) {
      prop.examples = [field.placeholder];
    }

    properties[field.name] = prop;
    if (field.required) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

interface DenyResolution {
  denied: Set<string>;
  failClosed: boolean;
}

async function safeResolveDenyList(
  permissions: PermissionsResolver,
  resolveInput: CreateFlowlibActionsMcpServerOptions['resolveDenyListInput'],
  logger: Logger,
): Promise<DenyResolution> {
  if (!resolveInput) {
    return { denied: new Set(), failClosed: false };
  }
  try {
    const input = resolveInput();
    return { denied: await permissions.getEffectiveDenyList(input), failClosed: false };
  } catch (err) {
    logger.warn?.(
      `[flowlib-actions-mcp] permission resolver threw; failing closed (no tools): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { denied: new Set(), failClosed: true };
  }
}

interface CredentialFilter {
  userTypes: Set<string> | null;
  permits(action: ActionDefinition): boolean;
}

async function resolveCredentialFilter(
  registry: ActionRegistry,
  lister: CredentialsLister | undefined,
  cached: Set<string> | null,
  logger: Logger,
): Promise<CredentialFilter> {
  if (!lister) {
    return {
      userTypes: null,
      permits: () => true,
    };
  }

  let userTypes = cached;
  if (!userTypes) {
    try {
      const creds = await lister.list();
      userTypes = new Set(
        creds.map((c) => c.type).filter((t): t is string => typeof t === 'string' && t.length > 0),
      );
    } catch (err) {
      logger.warn?.(
        `[flowlib-actions-mcp] credentials lister threw; allowing all credential-bound actions: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Fail open on credential capability — if we can't query the
      // credentials API the user might still have what they need; let
      // tool execution surface the error.
      return { userTypes: null, permits: () => true };
    }
  }

  const types = userTypes;
  return {
    userTypes,
    permits(action) {
      const cred = action.credential;
      if (!cred?.required) {
        return true;
      }
      // OAuth2 actions match by oauth2 provider id (treated as type).
      if (cred.oauth2Provider) {
        return types.has(cred.oauth2Provider);
      }
      if (cred.type) {
        return types.has(cred.type);
      }
      // Required-but-untyped credential — let it through; runtime will
      // surface "missing credential" if the agent doesn't pass one.
      void registry;
      return true;
    },
  };
}

async function executeOne(
  visible: VisibleTool,
  args: Record<string, unknown>,
  opts: CreateFlowlibActionsMcpServerOptions,
  workspace: WorkspaceHandle | undefined,
  logger: Logger,
): Promise<CallToolResult> {
  const action = visible.action;
  if (!action) {
    return errorResult(`Internal: no action bound to tool '${visible.toolName}'.`);
  }
  // Re-check deny list at call time too — defence in depth in case the
  // tool list went stale between the model's decision and the dispatch.
  const denyResolution = await safeResolveDenyList(
    opts.permissions,
    opts.resolveDenyListInput,
    logger,
  );
  if (denyResolution.failClosed || denyResolution.denied.has(visible.actionId)) {
    return errorResult(`Tool '${visible.toolName}' is not permitted in this session.`);
  }

  const hooks = typeof opts.callHooks === 'function' ? opts.callHooks() : opts.callHooks;
  const ctx: AgentToolExecutionContext<NodeExecutionContext> = {
    logger,
    iteration: hooks?.iteration ?? 0,
    maxIterations: hooks?.maxIterations ?? 1,
    nodeContext: hooks?.buildNodeContext?.() ?? buildMinimalNodeContext(opts, logger),
    staticParams: hooks?.staticParams,
    abortSignal: hooks?.abortSignal,
  };

  let result: AgentToolResult;
  try {
    result = await executeActionAsTool(action, args, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error?.(`[flowlib-actions-mcp] action '${visible.actionId}' threw: ${msg}`);
    return errorResult(`Tool '${visible.toolName}' threw: ${msg}`);
  }

  const text = stringifyResult(result);
  const toolCallId = deriveToolCallId(visible.toolName, opts.sessionId);
  const stored = opts.toolOutputStore
    ? await opts.toolOutputStore.store({
        toolCallId,
        output: text,
        budget: hooks?.budget,
        workspace,
      })
    : {
        inline: text,
        truncated: false,
        fullOutputRef: undefined as string | undefined,
        totalBytes: 0,
        totalLines: 0,
      };

  return {
    content: [{ type: 'text', text: stored.inline }],
    isError: result.success === false,
    _meta: stored.truncated
      ? {
          'flowlib.toolOutput.truncated': true,
          'flowlib.toolOutput.fullOutputRef': stored.fullOutputRef,
          'flowlib.toolOutput.totalLines': stored.totalLines,
          'flowlib.toolOutput.totalBytes': stored.totalBytes,
          'flowlib.toolOutput.toolCallId': toolCallId,
        }
      : undefined,
  } satisfies CallToolResult;
}

/** Built-in `read_tool_output` handler for workspace-less sessions. */
async function executeReadToolOutput(
  args: Record<string, unknown>,
  store: ToolOutputStore | undefined,
  logger: Logger,
): Promise<CallToolResult> {
  if (!store) {
    return errorResult('read_tool_output is unavailable: no tool-output store is configured.');
  }
  const toolCallId = typeof args.toolCallId === 'string' ? args.toolCallId : '';
  if (!toolCallId) {
    return errorResult(
      "read_tool_output requires a 'toolCallId' (from the truncated output footer).",
    );
  }
  const offset = typeof args.offset === 'number' ? args.offset : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  const grep = typeof args.grep === 'string' && args.grep.length > 0 ? args.grep : undefined;

  try {
    const slice = await store.readSlice(toolCallId, { offset, limit, grep });
    if (slice === undefined) {
      return errorResult(
        `read_tool_output: no stored output for toolCallId '${toolCallId}' ` +
          '(it may have been evicted, or never stored — only truncated outputs ' +
          'in the current session are queryable).',
      );
    }
    return {
      content: [{ type: 'text', text: slice }],
      isError: false,
    } satisfies CallToolResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn?.(`[flowlib-actions-mcp] read_tool_output threw: ${msg}`);
    return errorResult(`read_tool_output failed: ${msg}`);
  }
}

function buildReadToolOutputDescriptor(): Tool {
  return {
    name: READ_TOOL_OUTPUT_TOOL_NAME,
    description:
      'Read a slice of a previously-truncated tool output that was stored ' +
      'in the session. Use this to fetch lines past the inline budget when ' +
      'a prior tool call returned `[output truncated …]`.',
    inputSchema: {
      type: 'object',
      properties: {
        toolCallId: {
          type: 'string',
          description: 'The toolCallId from the truncated output footer.',
        },
        offset: {
          type: 'number',
          description: 'Line offset to start from (0-based). Default: 0.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return. Default: 100.',
        },
        grep: {
          type: 'string',
          description:
            'Optional substring filter — only lines containing this string ' +
            'are returned. Applied before offset/limit slicing.',
        },
      },
      required: ['toolCallId'],
    },
  } satisfies Tool;
}

function buildMinimalNodeContext(
  opts: CreateFlowlibActionsMcpServerOptions,
  logger: Logger,
): NodeExecutionContext {
  // The agent loop should normally supply a real `NodeExecutionContext`
  // via `buildNodeContext`. This minimal version is only used in tests
  // and in degraded production paths where the loop didn't wire the
  // hook. We deliberately leave most fields as undefined so any access
  // surfaces as a TS error early.
  return {
    logger,
    nodeId: `mcp:${opts.sessionId}`,
    flowId: `agents:${opts.sessionId}`,
    flowRunId: `agents-run:${opts.sessionId}`,
    traceId: undefined,
    incomingData: {},
    flowInputs: {},
    edges: [],
    nodes: [],
    skippedNodeIds: new Set(),
    flowParams: {},
    globalConfig: {},
    functions: {} as NodeExecutionContext['functions'],
  } as unknown as NodeExecutionContext;
}

function stringifyResult(result: AgentToolResult): string {
  if (!result.success) {
    return result.error ?? 'Tool failed without an error message.';
  }
  const out = result.output;
  if (out === undefined || out === null) {
    return 'OK';
  }
  if (typeof out === 'string') {
    return out;
  }
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    return String(out);
  }
}

function deriveToolCallId(toolName: string, sessionId: string): string {
  // No structured id from the MCP request — synthesize one. Sessions
  // typically attach their own id to outputs upstream.
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${sessionId}-${toolName}-${stamp}${rand}`;
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  } satisfies CallToolResult;
}

function notifyToolListChanged(server: Server, logger: Logger): Promise<void> {
  // Skip the call entirely when the server has no transport — the SDK
  // throws "Not connected" synchronously inside an `async` body, which
  // creates a rejected promise; under `@cloudflare/vitest-pool-workers`
  // the workerd runtime flags that as unhandled before the awaiting
  // microtask gets a chance to attach `.catch`. Checking `transport`
  // up front is the same guard `McpServer.isConnected()` uses.
  if (!isServerConnected(server)) {
    logger.debug?.('[flowlib-actions-mcp] sendToolListChanged skipped: server not connected');
    return Promise.resolve();
  }
  return server.sendToolListChanged().catch((err) => {
    logger.debug?.(
      `[flowlib-actions-mcp] sendToolListChanged skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

function isServerConnected(server: Server): boolean {
  // `Protocol._transport` is private but the SDK's `McpServer.isConnected`
  // reads `server.transport`, which is publicly accessible on the
  // `Protocol` superclass via property mangling. Cast to `any` rather
  // than depending on the private field name.
  return (server as unknown as { transport?: unknown }).transport !== undefined;
}
