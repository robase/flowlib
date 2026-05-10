/// <reference types="@cloudflare/workers-types" />
/**
 * `AgentChatDO` — the Cloudflare Durable Object that hosts one agent
 * session in v1 (Mode 2).
 *
 * The DO extends the Cloudflare Agents SDK's `AIChatAgent`, which
 * gives us for free:
 *  - WebSocket lifecycle (the frontend's `useAgent` hook attaches via
 *    `useAgent({ agent: 'AgentChatDO', name: doAgentName })`).
 *  - DO-storage-backed message history (`this.messages`).
 *  - Hibernation-safe streaming (resumable streams via
 *    `_storeStreamChunk` and `_sendStreamChunks`).
 *  - Abort wiring on disconnect.
 *
 * Each DO instance is keyed by a tenant-scoped name (see
 * `tenant-scoped-id.ts`):
 *
 *     org:${orgId}/kind:chat/${sessionId}
 *
 * so two requests from different orgs that share a session id route to
 * different DO instances, with no cross-tenant code path.
 *
 * # `wrangler.jsonc` migration
 *
 * The consumer Worker's `wrangler.jsonc` MUST declare:
 *
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [
 *       { "name": "AgentChatDO", "class_name": "AgentChatDO" }
 *     ]
 *   },
 *   "migrations": [
 *     { "tag": "v1", "new_sqlite_classes": ["AgentChatDO"] }
 *   ]
 * }
 * ```
 *
 * # Module-level runtime singleton
 *
 * The DO can't import the agents-plugin runtime registries directly —
 * those live on a `PluginContext` the Worker built during
 * `createFlowlib({ plugins: [agents(...)] })`. We bridge across with a
 * per-isolate singleton (`runtime-singleton.ts`). The Worker's `init()`
 * runs at module-load time so the singleton is always populated before
 * any DO request lands.
 *
 * # What runs where
 *
 * - The DO **does not** fetch repositories, audit logs, or compose the
 *   system prompt — that's done in Stream I's REST endpoints when the
 *   session is created. By the time a chat connection arrives, the
 *   `SessionContext` is already buildable from the runtime singleton +
 *   the tenant-scoped DO name.
 * - The DO **does** call `agentService.runTurn(ctx, prompt)` per
 *   incoming user message, wiring `ctx.emit` so each `AgentEvent` is
 *   forwarded over the WebSocket.
 *
 * # WebSocket transport
 *
 * The frontend connects with `useAgent`, which speaks the Agents SDK's
 * built-in protocol (`CF_AGENT_*` message types). `AIChatAgent` handles
 * the framing; we only see `onChatMessage(onFinish, options)` calls
 * with the full message history on `this.messages`.
 *
 * To push our `AgentEvent`s to the WebSocket we use `this.broadcast` —
 * inherited from PartyServer via `Agent` — wrapped in a custom
 * `flowlib.agent-event` envelope. Stream M (frontend chat) listens for
 * these messages and renders them.
 */

import { AIChatAgent } from 'agents/ai-chat-agent';
import type {
  AIChatAgent as AIChatAgentType,
  StreamTextOnFinishCallback,
  ToolSet,
  OnChatMessageOptions,
} from '@cloudflare/ai-chat';

import type { AgentEvent } from '../../shared/events';
import type { AgentsAuthContext } from '../../shared/auth-context';
import type { AgentService, PersistenceCallbacks, SessionContext } from '../service/types';
import type { PromptInput } from '../providers/types';

import { getAgentsRuntime } from './runtime-singleton';

/**
 * The minimum Worker env shape `AgentChatDO` requires. Consumer
 * Workers extend their own `Env` with this binding.
 */
export interface AgentChatDOEnv {
  /** This same DO class, bound under its conventional name. */
  AgentChatDO: DurableObjectNamespace;
}

/**
 * Frame used to push our `AgentEvent` union over the WebSocket alongside
 * the SDK's protocol traffic. Stream M (frontend chat) decodes this
 * envelope.
 */
interface AgentEventEnvelope {
  type: 'flowlib.agent-event';
  event: AgentEvent;
}

/**
 * Frame the SDK does not natively understand — used to surface
 * orchestration-level errors back to the client without stuffing them
 * into the chat-message stream.
 */
interface AgentErrorEnvelope {
  type: 'flowlib.agent-error';
  error: { message: string; code?: string };
}

/**
 * Information the DO caches in-memory so that subsequent
 * `onChatMessage` calls can reuse the resolved auth context and
 * session metadata. The values are populated by the first WebSocket
 * upgrade in `onConnect`.
 *
 * **Hibernation note**: `AIChatAgent`'s base class re-runs `onConnect`
 * after wake, so this cache is rebuilt on each cold start.
 */
interface ResolvedConnectionState {
  auth: AgentsAuthContext;
  /** Session id parsed out of the DO name suffix. */
  sessionId: string;
  /** Org id parsed out of the DO name prefix. */
  orgId: string;
}

/**
 * Parse the `org:${orgId}/kind:chat/${sessionId}` name back into its
 * parts. Throws on malformed input — the DO is unreachable except via
 * `tenantScopedId` so this should never fail in production.
 */
function parseAgentName(name: string): { orgId: string; sessionId: string } {
  const match = /^org:([^/]+)\/kind:chat\/(.+)$/.exec(name);
  if (!match) {
    throw new Error(
      `[agents] AgentChatDO: malformed DO name "${name}" — expected ` +
        '"org:${orgId}/kind:chat/${sessionId}"',
    );
  }
  return { orgId: match[1], sessionId: match[2] };
}

/**
 * Bridge to TypeScript: import the SDK's class as a value but type its
 * `this` against our shim type so methods we override line up.
 */
type AgentChatDOSelf = AIChatAgentType<AgentChatDOEnv> & AgentChatDO;

/**
 * The Durable Object class. **Must be re-exported from the consumer
 * Worker's entry** so the runtime can find it for the `migrations`
 * declaration:
 *
 * ```ts
 * // worker.ts
 * export { AgentChatDO } from '@flowlib/agents';
 * ```
 */
export class AgentChatDO extends (AIChatAgent as unknown as new (
  ...args: ConstructorParameters<typeof AIChatAgent<AgentChatDOEnv>>
) => AIChatAgentType<AgentChatDOEnv>) {
  /**
   * Resolved connection metadata. Populated lazily on first message,
   * since `onConnect` runs only on initial upgrade and the SDK may
   * dispatch `onChatMessage` from a hibernation-restored connection
   * where the in-memory cache has been cleared.
   */
  private _resolved: ResolvedConnectionState | null = null;

  /**
   * Override of `AIChatAgent.onChatMessage`. Builds the
   * `SessionContext`, calls the runtime's `AgentService.runTurn`, and
   * resolves the SDK's `onFinish` callback when the turn completes.
   *
   * Returns `undefined` because we stream events ourselves over the
   * WebSocket via `_emitAgentEvent`; the SDK's response stream is
   * unused. This preserves the SDK's persistence contract: the
   * promise's lifetime gates `onFinish`, which gates message-history
   * persistence.
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response | undefined> {
    const self = this as unknown as AgentChatDOSelf;
    const runtime = getAgentsRuntime();
    const agentService = runtime.agentService as AgentService | undefined;
    if (!agentService) {
      this._emitError({
        message:
          'AgentService not registered on the agents runtime — Stream A ' +
          'must register before any chat connection lands.',
        code: 'AGENT_SERVICE_MISSING',
      });
      return undefined;
    }

    let resolved: ResolvedConnectionState;
    try {
      resolved = this._ensureResolved();
    } catch (err) {
      this._emitError({
        message: err instanceof Error ? err.message : String(err),
        code: 'AGENT_DO_NAME_INVALID',
      });
      return undefined;
    }

    // Pull the just-arrived user message off `this.messages`.
    const lastMessage = self.messages[self.messages.length - 1];
    const promptText = extractPromptText(lastMessage);
    if (!promptText) {
      this._emitError({
        message: 'No user-message text found in chat payload.',
        code: 'EMPTY_PROMPT',
      });
      return undefined;
    }

    const sessionContext = await this._buildSessionContext(resolved, options);
    if (!sessionContext) {
      // _buildSessionContext emitted the error already.
      return undefined;
    }

    const promptInput: PromptInput = {
      providerSessionId: sessionContext.providerSessionId,
      parts: [{ type: 'text', text: promptText }],
      abortSignal: sessionContext.abortSignal,
    };

    try {
      const result = await agentService.runTurn(sessionContext, promptInput);
      // Hand control back to the SDK so it can persist the
      // assistant message it has been streaming. The result we pass
      // through is best-effort — the SDK only inspects `usage`.
      await onFinish({
        finishReason: result.reason,
        usage: {
          inputTokens: result.inputTokensTotal,
          outputTokens: result.outputTokensTotal,
        },
      });
    } catch (err) {
      this._emitError({
        message: err instanceof Error ? err.message : String(err),
        code: 'RUN_TURN_FAILED',
      });
    }

    return undefined;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Resolve the DO's tenant context lazily. The DO's name carries the
   * `orgId` + `sessionId`, which is sufficient to look up the rest from
   * D1 in `_buildSessionContext`. `userId` and `role` come from the
   * connection's request headers (set by Stream I when handing out the
   * `doAgentName`).
   *
   * In v1 the auth context is **sticky** for the session — the first
   * connection's identity wins, matching the implementation plan
   * ("Resolved auth context for the *first* turn — sticky for the
   * session.").
   */
  private _ensureResolved(): ResolvedConnectionState {
    if (this._resolved) {
      return this._resolved;
    }
    const self = this as unknown as { name?: string };
    const doName = typeof self.name === 'string' ? self.name : '';
    const { orgId, sessionId } = parseAgentName(doName);
    // v1 fallback: the userId / role are not on the connection in
    // this isolated context. Stream I will be extended to pass them
    // through (e.g. via the upgrade request URL params); until then
    // we use a placeholder that other subsystems can recognise.
    this._resolved = {
      auth: {
        userId: 'do:resolved-later',
        orgId,
        role: 'user',
        teamIds: [],
      },
      orgId,
      sessionId,
    };
    return this._resolved;
  }

  /**
   * Build a one-shot `SessionContext` for this turn. Pulls the
   * provider, workspace, hooks, permissions and persistence callbacks
   * out of the runtime singleton.
   *
   * Returns `null` (and emits an error envelope) when a required
   * subsystem isn't registered — the DO degrades gracefully so the
   * client gets a useful error instead of a connection drop.
   */
  private async _buildSessionContext(
    resolved: ResolvedConnectionState,
    options?: OnChatMessageOptions,
  ): Promise<SessionContext | null> {
    const runtime = getAgentsRuntime();
    const repositories = runtime.repositories as
      | { sessions: { findById(id: string): Promise<unknown> } }
      | undefined;
    if (!repositories) {
      this._emitError({
        message: 'Repositories not registered on the agents runtime.',
        code: 'REPOSITORIES_MISSING',
      });
      return null;
    }

    // Stream F's SessionsRepository returns a row including the
    // provider id and providerSessionId. We narrow loosely here so the
    // DO doesn't depend on the repository's concrete row type.
    const sessionRow = (await repositories.sessions.findById(resolved.sessionId)) as
      | {
          providerId: string;
          providerSessionId: string;
          orgId: string;
          workspaceId?: string;
        }
      | undefined;

    if (!sessionRow) {
      this._emitError({
        message: `Session ${resolved.sessionId} not found`,
        code: 'SESSION_NOT_FOUND',
      });
      return null;
    }
    if (sessionRow.orgId !== resolved.orgId) {
      // Defence-in-depth: the DO name already encodes orgId, but if a
      // session moved orgs (shouldn't happen) we never want to surface
      // the cross-tenant data.
      this._emitError({
        message: 'Session does not belong to this org.',
        code: 'CROSS_TENANT_DENIED',
      });
      return null;
    }

    const provider = runtime.providers.get(sessionRow.providerId);
    if (!provider) {
      this._emitError({
        message: `Provider ${sessionRow.providerId} not registered`,
        code: 'PROVIDER_NOT_FOUND',
      });
      return null;
    }

    const hooks =
      (runtime.hookPipeline as SessionContext['hooks'] | undefined) ?? noopHookPipeline();
    const permissions =
      (runtime.permissions as SessionContext['permissions'] | undefined) ?? allowAllPermissions();
    const callbacks = buildPersistenceCallbacks(runtime);
    const abortController = new AbortController();
    if (options?.abortSignal) {
      const sig = options.abortSignal;
      if (sig.aborted) {
        abortController.abort();
      } else {
        sig.addEventListener('abort', () => abortController.abort());
      }
    }

    return {
      sessionId: resolved.sessionId,
      providerSessionId: sessionRow.providerSessionId,
      auth: resolved.auth,
      provider,
      // Workspace lookup is provider-specific; v1 leaves it undefined
      // when the provider doesn't require one. Stream E + Stream I will
      // wire workspace loading through the runtime once they land.
      workspace: undefined,
      hooks,
      permissions,
      logger: createSessionLogger(this),
      callbacks,
      emit: (event: AgentEvent) => {
        this._emitAgentEvent(event);
      },
      abortSignal: abortController.signal,
    };
  }

  /**
   * Push an `AgentEvent` over every connected WebSocket. Wrapping the
   * payload in a `flowlib.agent-event` envelope distinguishes our
   * events from the SDK's own protocol traffic.
   */
  private _emitAgentEvent(event: AgentEvent): void {
    const envelope: AgentEventEnvelope = {
      type: 'flowlib.agent-event',
      event,
    };
    this._broadcastEnvelope(envelope);
  }

  /** Push an orchestration-level error to all connected clients. */
  private _emitError(error: { message: string; code?: string }): void {
    const envelope: AgentErrorEnvelope = { type: 'flowlib.agent-error', error };
    this._broadcastEnvelope(envelope);
  }

  /**
   * Broadcast a JSON-serializable envelope to every connection on this
   * DO. Uses the inherited `broadcast` method from PartyServer (via
   * `Agent`).
   */
  private _broadcastEnvelope(envelope: AgentEventEnvelope | AgentErrorEnvelope): void {
    const self = this as unknown as {
      broadcast: (msg: string) => void;
    };
    self.broadcast(JSON.stringify(envelope));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Pull the user prompt out of a `UIMessage`. Tolerates both the AI
 * SDK's structured `parts` array and a flat `content` string.
 */
function extractPromptText(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const m = message as { content?: unknown; parts?: unknown };
  if (typeof m.content === 'string' && m.content.length > 0) {
    return m.content;
  }
  if (Array.isArray(m.parts)) {
    const text = m.parts
      .filter(
        (p): p is { type: string; text: string } =>
          typeof p === 'object' &&
          p !== null &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string',
      )
      .map((p) => p.text)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

/**
 * Build the `PersistenceCallbacks` object the kernel calls. v1 is a
 * pass-through that delegates to the runtime's repositories bag if it
 * is present and exposes a compatible `messages` repo, otherwise no-ops
 * so the DO can still run end-to-end during stream-by-stream wiring.
 *
 * Stream I will own the real persistence layer — this scaffold matches
 * the interface and is replaced when the wiring lands.
 */
function buildPersistenceCallbacks(runtime: { repositories?: unknown }): PersistenceCallbacks {
  const repos = runtime.repositories as
    | { messages?: { append?: (input: unknown) => Promise<void> } }
    | undefined;
  const append = repos?.messages?.append;

  const noop = (): Promise<void> => Promise.resolve();
  if (!append) {
    return {
      onMessageStart: noop,
      onTextDelta: noop,
      onToolCall: noop,
      onToolResult: noop,
      onFileEdit: noop,
      onMessageComplete: noop,
      onTurnEnd: noop,
    };
  }

  return {
    onMessageStart: (input) => append({ kind: 'message-start', ...input }),
    onTextDelta: (input) => append({ kind: 'text-delta', ...input }),
    onToolCall: (input) => append({ kind: 'tool-call', ...input }),
    onToolResult: (input) => append({ kind: 'tool-result', ...input }),
    onFileEdit: (input) => append({ kind: 'file-edit', ...input }),
    onMessageComplete: (input) => append({ kind: 'message-complete', ...input }),
    onTurnEnd: (input) => append({ kind: 'turn-end', ...input }),
  };
}

/** Default empty hook pipeline. */
function noopHookPipeline(): SessionContext['hooks'] {
  return {
    preToolUse: [],
    postToolUse: [],
    preMessage: [],
  } as unknown as SessionContext['hooks'];
}

/** Default permissive permissions resolver. */
function allowAllPermissions(): SessionContext['permissions'] {
  return {
    getEffectiveDenyList: async () => new Set<string>(),
  } as unknown as SessionContext['permissions'];
}

/** Wrap the DO's logger surface in the kernel's `SessionLogger` shape. */
/* eslint-disable no-console */
function createSessionLogger(_do: AgentChatDO): SessionContext['logger'] {
  const tag = '[AgentChatDO]';
  return {
    debug(message, meta) {
      console.debug(tag, message, meta ?? {});
    },
    info(message, meta) {
      console.info(tag, message, meta ?? {});
    },
    warn(message, meta) {
      console.warn(tag, message, meta ?? {});
    },
    error(message, meta) {
      console.error(tag, message, meta ?? {});
    },
  };
}
/* eslint-enable no-console */
