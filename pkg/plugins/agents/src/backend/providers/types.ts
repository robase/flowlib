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
export interface CreateSessionInput {
  /** Resolved auth context (org/user/role). */
  auth: AgentsAuthContext;
  /** Validated config from the agent definition. */
  config: AgentProviderConfig;
  /** Workspace handle, present iff `capabilities.workspaceRequired`. */
  workspace?: import('../workspaces/types').WorkspaceHandle;
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
  /** Cancel the iterator. Provider must honour `signal.aborted`. */
  abortSignal: AbortSignal;
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
