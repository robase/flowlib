/**
 * `AgentService` types — the orchestration kernel's public surface.
 *
 * Stream A implements the kernel against these types. The kernel is
 * intentionally **table-agnostic**: it consumes a `SessionContext`
 * built by Stream I (endpoints) and emits events to a sink supplied
 * by the caller (DO over WebSocket in CF mode, SSE writer in Node mode).
 */

import type { AgentEvent } from '../../shared/events';
import type { AgentsAuthContext } from '../../shared/auth-context';
import type { AgentProvider, PromptInput } from '../providers/types';
import type { WorkspaceHandle } from '../workspaces/types';
import type { HookPipeline } from '../hooks/types';
import type { PermissionsResolver } from '../permissions/types';

/**
 * Everything the kernel needs to run one or more turns of a session.
 *
 * Built once per session boot. Carries references the kernel reads
 * (provider, workspace, hooks) plus persistence callbacks the kernel
 * fires at well-known points.
 */
export interface SessionContext {
  /** Stable session id (matches `agent_sessions.id`). */
  sessionId: string;
  /** Provider-side session id, opaque to the kernel. */
  providerSessionId: string;
  /** Resolved auth context for the *first* turn — sticky for the session. */
  auth: AgentsAuthContext;
  /** Resolved provider singleton. */
  provider: AgentProvider;
  /** Workspace handle, present iff `provider.capabilities.workspaceRequired`. */
  workspace?: WorkspaceHandle;
  /** Hook pipeline (see Stream S1). May be empty in v1. */
  hooks: HookPipeline;
  /** Permissions resolver (Stream J). */
  permissions: PermissionsResolver;
  /** Logger. */
  logger: SessionLogger;
  /** Persistence callbacks (the kernel doesn't touch tables directly). */
  callbacks: PersistenceCallbacks;
  /**
   * Sink the kernel pushes events to. Returns when the consumer has
   * accepted the event (so back-pressure can be applied). In CF mode
   * this writes to the DO's WebSocket; in tests it pushes to an array.
   */
  emit: (event: AgentEvent) => void | Promise<void>;
  /** Cancel signal — turning the iterator off mid-stream. */
  abortSignal: AbortSignal;
  /** Per-session model override. */
  defaultModel?: string;
}

/**
 * Minimal logger surface the service uses. Compatible with Flowlib's
 * `ScopedLogger` so the same instance can be passed straight in.
 */
export interface SessionLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Persistence hooks — Stream A calls these at well-defined points
 * without knowing what backs them. Stream I (endpoints + repositories)
 * supplies the implementations.
 */
export interface PersistenceCallbacks {
  /** A new assistant or user message just started streaming. */
  onMessageStart(input: { messageId: string; role: 'assistant' | 'user' }): Promise<void>;
  /** Append a delta to a message-in-flight. */
  onTextDelta(input: { messageId: string; text: string }): Promise<void>;
  /** Persist a completed tool call. */
  onToolCall(input: { messageId: string; id: string; name: string; input: unknown }): Promise<void>;
  /** Persist the matching tool result. */
  onToolResult(input: {
    messageId: string;
    id: string;
    output: unknown;
    isError?: boolean;
  }): Promise<void>;
  /** Persist a file edit summary. */
  onFileEdit(input: {
    messageId: string;
    path: string;
    before?: string;
    after?: string;
  }): Promise<void>;
  /** A message finished. */
  onMessageComplete(input: {
    messageId: string;
    usage?: { inputTokens: number; outputTokens: number };
  }): Promise<void>;
  /** The whole turn ended. */
  onTurnEnd(input: {
    reason: 'stopped' | 'max-turns' | 'error' | 'completed';
    error?: string;
  }): Promise<void>;
}

/**
 * Result of one turn — the resolved totals after the iterator drained.
 */
export interface RunResult {
  reason: 'stopped' | 'max-turns' | 'error' | 'completed';
  /** Number of assistant messages produced this turn. */
  messageCount: number;
  /** Number of tool calls invoked this turn. */
  toolCallCount: number;
  /** Token totals across all messages in the turn. */
  inputTokensTotal: number;
  outputTokensTotal: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Set when `reason === 'error'`. */
  error?: string;
}

/**
 * The kernel's public surface. Stream A's `AgentService` implements this.
 */
export interface AgentService {
  /**
   * Run one user-prompt turn.
   *
   * Iterates the provider's stream, fires hooks, persists at each
   * boundary, emits events to `ctx.emit`. Returns the aggregate
   * `RunResult` once the iterator drains or `ctx.abortSignal` fires.
   */
  runTurn(ctx: SessionContext, prompt: PromptInput): Promise<RunResult>;
}
