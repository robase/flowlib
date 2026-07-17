/**
 * `AgentProvider` — the interface every code-editing / chat backend implements.
 *
 * Implementations: `claudeCodeProvider` (Stream C), `openCodeProvider`
 * (Stream D), `rawLlmProvider` (post-v1). Provider SDK imports MUST be
 * lazy (inside `createSession` / `prompt`), so apps that only use one
 * provider don't pay for the others' bundle weight.
 */

import type { AgentEvent } from '../../shared/events';
import type { AgentsAuthContext } from '../../shared/auth-context';

// ─── Capabilities ───────────────────────────────────────────────────────

/**
 * Static capabilities advertised by a provider. The frontend reads these
 * to decide which UI affordances to render — e.g. the permission-mode
 * picker only shows up when `permissionPrompts` is true.
 */
export interface AgentCapabilities {
  /** Provider streams partial assistant text. */
  streaming: boolean;
  /** Provider invokes tools / function-calls during a turn. */
  toolUse: boolean;
  /** Provider accepts MCP server config to expand its tool surface. */
  mcpServers: boolean;
  /** Provider can run multiple tool calls in one assistant turn. */
  parallelToolCalls: boolean;
  /** Provider modifies workspace files (`Write`/`Edit`/`Bash`). */
  fileEdits: boolean;
  /**
   * Provider supports event-id-based stream resume. Useful for the
   * deferred Express SSE deployment; CF mode delegates resume to the
   * Agents SDK's WebSocket buffer, so this is informational.
   */
  resumableStream: boolean;
  /** Provider requires a workspace at session-create time. */
  workspaceRequired: boolean;
  /**
   * Provider supports interactive permission prompts (Claude Code's
   * `canUseTool` callback). Drives whether the HIL permission UI is
   * available for sessions on this provider.
   */
  permissionPrompts: boolean;
  /**
   * Optional preferred workspace provider id for this agent. When set
   * and registered, the sessions endpoint uses it to auto-provision a
   * workspace for sessions that omit `workspaceId`. Falls back to the
   * first registered workspace provider when unset or unregistered.
   *
   * Example: claude-code prefers `'cloudflare-sandbox-claude'` (image
   * with the `claude` CLI baked in); opencode prefers
   * `'cloudflare-sandbox'` (image with the `opencode` CLI baked in).
   */
  preferredWorkspaceProviderId?: import('../workspaces/types').WorkspaceProviderId;
}

// ─── Inputs ─────────────────────────────────────────────────────────────

/**
 * Validated provider config — opaque to the orchestrator. Each provider
 * narrows this to its own shape inside `validateConfig`.
 */
export type AgentProviderConfig = Record<string, unknown>;

/**
 * Input to `createSession`. Carries everything the provider needs to
 * stand up a new conversation thread.
 */
/**
 * Decrypted credential row a provider inspects to source an LLM key.
 * Structural subset of Flowlib's credential record.
 */
export interface ResolvedCredentialRow {
  name?: string;
  authType?: string;
  /** Decrypted config — `apiKey`, optional `baseUrl`, `oauth2Provider`, … */
  config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  provider?: string;
}

/**
 * Minimal credentials accessor the host threads into providers (the
 * agents plugin sets it from `flowlib.credentials`). Returns the
 * **decrypted** credential so a provider can read its `apiKey`.
 */
export interface AgentCredentialsAccessor {
  getDecryptedWithRefresh(id: string): Promise<ResolvedCredentialRow | null | undefined>;
}

export interface CreateSessionInput {
  /** Resolved auth context (org/user/role). */
  auth: AgentsAuthContext;
  /** Validated config from the agent definition. */
  config: AgentProviderConfig;
  /** Workspace handle, present iff `capabilities.workspaceRequired`. */
  workspace?: import('../workspaces/types').WorkspaceHandle;
  /**
   * Lazy workspace provisioner. Providers whose
   * `capabilities.workspaceRequired` is `false` receive this *instead of*
   * an eager `workspace` and call it the first time a tool actually needs
   * the sandbox — deferring (and for pure-chat turns, skipping) the
   * container cold-start. The host implementation creates the workspace
   * row if missing, persists the workspace id onto the session, resolves
   * the handle, and caches it. Providers that require a workspace up
   * front (`workspaceRequired: true`) can ignore this and use `workspace`.
   */
  ensureWorkspace?: import('../workspaces/types').WorkspaceAccessor;
  /** Initial system prompt (composed by Stream K). */
  systemPrompt?: string;
  /**
   * Optional Flowlib credential id selected by the user when starting
   * the session. The provider resolves it via the credentials service
   * to source the LLM API key — overriding any factory-default
   * credential. When absent, providers fall back to their factory
   * credential (or fail if none is configured).
   */
  credentialId?: string;
  /**
   * Credentials accessor threaded in by the host runtime (the agents
   * plugin sets it from `flowlib.credentials`). Lets a provider resolve
   * the session's `credentialId` to an API key **without** the host
   * hand-wiring a `resolveCredential` — the `aiSdkProvider` uses it as a
   * built-in default. Per-request, so it stays correct multi-tenant.
   */
  credentials?: AgentCredentialsAccessor;
  /** Provider-specific extras (Claude Code: permissionMode, MCP, hooks). */
  extras?: Record<string, unknown>;
  /**
   * Pre-existing provider session id. When set, the provider should
   * use this string as the session's persistent id rather than
   * generating a new one, and treat the call as **idempotent** —
   * if internal state for this id is already populated, no-op; if
   * not, populate it from the supplied inputs.
   *
   * The hosted Cloudflare wiring uses this to rehydrate the
   * provider's per-isolate session map inside Durable Object isolates,
   * which start empty even when the original `createSession` call ran
   * in the parent Worker fetch isolate. Without rehydration the
   * provider throws "unknown session id" on the first prompt because
   * its in-memory cache (e.g. `sessionsById` for opencode) doesn't
   * carry across isolates.
   */
  providerSessionId?: string;
}

/**
 * A tool the *plugin* contributes to a turn (as opposed to the host's
 * `tools` factory or the provider's own catalogue). Provider-agnostic:
 * each provider adapts this shape to its native tool format. Used for
 * plugin-internal tools that close over plugin resources the host can't
 * reach — `skills.read` (skills repo), `memory.search` (memory adapter),
 * `read_tool_output` (output store).
 *
 * The shape is intentionally identical to the ai-sdk tool descriptor so
 * the ai-sdk provider can merge them with zero conversion.
 */
export interface ProviderToolDescriptor {
  description: string;
  /** JSON-Schema parameters object. */
  parameters: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    options: { abortSignal?: AbortSignal; toolCallId?: string },
  ) => Promise<unknown>;
}

/** Input for one `prompt()` turn. */
export interface PromptInput {
  /** Provider-side session id returned by `createSession`. */
  providerSessionId: string;
  /** User's prompt — text + optional images / attachment refs. */
  parts: ReadonlyArray<
    { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string }
  >;
  /** Per-turn override of the agent default model. */
  model?: string;
  /** Per-turn deny list addition (in addition to role-derived denies). */
  extraDenied?: ReadonlyArray<string>;
  /** Per-turn whitelist (if set, only listed tools are allowed). */
  enabledTools?: ReadonlyArray<string>;
  /**
   * Plugin-contributed tools for this turn, keyed by tool name. Merged
   * on top of the provider's own catalogue (plugin tools win on name
   * collision). Providers that don't support extra tools ignore this.
   */
  providerTools?: Record<string, ProviderToolDescriptor>;
  /** Cancel the iterator. Provider must honour `signal.aborted`. */
  abortSignal: AbortSignal;
  /**
   * Human-in-the-loop decision gate (see `SessionContext.decisionGate`).
   * Threaded onto the turn so a provider can **block** on a
   * permission-request / human-input-request (`await gate.awaitPermission(...)`)
   * instead of merely emitting the event. Optional — a provider that
   * ignores it keeps the legacy pass-through. Same gate on both transports
   * (DO + Express), so blocking behaves identically wherever the loop runs.
   */
  decisionGate?: import('../service/types').DecisionGate;
  /** Provider-specific extras (e.g. Claude `permissionMode` override). */
  extras?: Record<string, unknown>;
}

export interface ListMessagesInput {
  providerSessionId: string;
  /** Pagination cursor — usually a sequence number. */
  before?: string;
  limit?: number;
}

/** Provider-supplied historical message (subset of `AgentMessage`). */
export interface AgentProviderMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: ReadonlyArray<{ type: 'text'; text: string } | Record<string, unknown>>;
  createdAt: string;
}

/** Model entry returned by `provider.listModels()`. */
export interface AgentModel {
  /** Provider-namespaced id, e.g. `claude-code/claude-sonnet-4-5`. */
  id: string;
  /** UI label. */
  name: string;
  /** Optional context-window size in tokens. */
  contextWindow?: number;
  /** Free-form metadata (cost tier, vendor, …). */
  metadata?: Record<string, unknown>;
}

// ─── The provider interface ────────────────────────────────────────────

/**
 * The contract every provider implements.
 *
 * Lifetime: provider singletons are constructed once at plugin init
 * (Stream B) and reused across sessions. Per-session client state lives
 * inside the provider's own caches, keyed by `providerSessionId`.
 */
export interface AgentProvider {
  /** Stable id used in DB rows + URLs. */
  readonly id: string;
  /** Human label for the picker. */
  readonly name: string;
  /** Optional Lucide icon name. */
  readonly icon?: string;
  /**
   * Default model id used when a session omits `model`. Surfaced to the
   * UI picker (via `GET /agents/providers`) so the frontend pre-selects a
   * model that matches this provider's credential/gateway setup.
   */
  readonly defaultModel?: string;
  /** Static capability flags — see {@link AgentCapabilities}. */
  readonly capabilities: AgentCapabilities;

  /**
   * Validate provider-specific config when an agent is created/updated.
   * Throws on invalid config; returns the normalised shape on success.
   */
  validateConfig(config: unknown): AgentProviderConfig;

  /**
   * Create a session in the underlying provider; return a provider-side
   * id used for resume. Heavy SDK init goes here, behind a lazy `import()`.
   */
  createSession(input: CreateSessionInput): Promise<{ providerSessionId: string }>;

  /**
   * Run one user-prompt turn. MUST stream {@link AgentEvent}s via the
   * iterator. The orchestrator drains the iterator, fires hooks, and
   * forwards events to the WebSocket transport.
   */
  prompt(input: PromptInput): AsyncIterable<AgentEvent>;

  /** Optional — pull message history if the provider stores it. */
  listMessages?(input: ListMessagesInput): Promise<AgentProviderMessage[]>;

  /** Optional — surface available models to the UI. */
  listModels?(): Promise<AgentModel[]>;

  /** Cleanup resources when a session ends. */
  closeSession?(providerSessionId: string): Promise<void>;

  /** Cleanup at plugin shutdown. */
  shutdown?(): Promise<void>;
}
