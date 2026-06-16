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
import type { AgentService, DecisionGate } from '../service/types';
import {
  type ChatHostDeps,
  type PromptCache,
  type RepositoriesBag,
  createConsoleSessionLogger,
  createDecisionGate,
  createInMemoryPromptCache,
  runChatTurn,
} from '../service/chat-session-host';

import { ensureAgentsRuntime, getAgentsDatabaseApi } from './runtime-singleton';
import { createDefaultMcpClientFactory, type McpClientFactory } from '../mcp/client';

/** Lazily-built singleton MCP client factory (SDK import deferred to first use). */
let _mcpFactory: McpClientFactory | undefined;
function mcpClientFactory(): McpClientFactory {
  return (_mcpFactory ??= createDefaultMcpClientFactory());
}

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
 * Parse the `org__${orgId}__chat__${sessionId}` name back into its
 * parts. Throws on malformed input — the DO is unreachable except via
 * `tenantScopedId` so this should never fail in production.
 *
 * **Legacy format.** Earlier releases used `org:${orgId}/kind:chat/${sessionId}`,
 * but slashes get eaten by `partyserver`'s URL router. The legacy
 * regex is kept as a fallback so DO instances that survived an
 * upgrade still resolve.
 */
function parseAgentName(name: string): { orgId: string; sessionId: string } {
  const match = /^org__(.+?)__chat__(.+)$/.exec(name);
  if (match) {
    return { orgId: match[1], sessionId: match[2] };
  }
  const legacy = /^org:([^/]+)\/kind:chat\/(.+)$/.exec(name);
  if (legacy) {
    return { orgId: legacy[1], sessionId: legacy[2] };
  }
  throw new Error(
    `[agents] AgentChatDO: malformed DO name "${name}" — expected ` +
      '"org__${orgId}__chat__${sessionId}"',
  );
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
   * Composed-prompt cache for this DO instance's lifetime (the host
   * memoises against it). Recomputed on DO eviction/restart — a
   * mid-session systemPrompt/denyList edit takes effect on the next cold
   * DO. Lazily initialised (field initializers don't run when the SDK
   * base constructs us, and tests build via `Object.create`).
   */
  private _promptCache?: PromptCache;
  /**
   * Human-in-the-loop decision gate. `onMessage` resolves it when a
   * `flowlib.permission-response` / `flowlib.hil-response` control frame
   * arrives; the provider (when it consults `ctx.decisionGate`) awaits it.
   * Lazily initialised (see `_promptCache`).
   */
  private _decisionGate?: DecisionGate;
  /** AbortController for the in-flight turn — wired to `flowlib.interrupt`. */
  private _activeAbort: AbortController | null = null;

  // ── Diagnostic overrides ─────────────────────────────────────────
  // These wrap the partyserver / AIChatAgent dispatch chain so we can
  // see *which* layer a chat frame reaches before getting dropped. See
  // `docs/cloudflare-agents-routing.md` for the full chain.
  //
  // Order of logs we expect on a healthy send:
  //   [AgentChatDO] onConnect in        (first attach only)
  //   [AgentChatDO] onMessage in        (every inbound frame)
  //   [AgentChatDO] persistMessages in  (after envelope decode)
  //   [AgentChatDO] persistMessages out
  //   [AgentChatDO] onChatMessage in    (after concurrency+persist)
  //   …[agents/opencode] firing client.session.prompt…
  //
  // A missing log identifies the layer where the frame dies.

  async onConnect(connection: unknown, ctx: unknown): Promise<void> {
    const doName = (this as unknown as { name?: string }).name ?? '<unnamed>';
    const conn = connection as { id?: string; uri?: string } | undefined;
    const rctx = ctx as { request?: { url?: string } } | undefined;
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] onConnect in', {
      doName,
      connectionId: conn?.id,
      uri: conn?.uri,
      requestUrl: rctx?.request?.url,
    });
    try {
      // @ts-expect-error super is typed through the `unknown` cast on the
      // extends clause above, so TS can't see its methods.
      return await super.onConnect(connection, ctx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] onConnect threw', {
        doName,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      });
      throw err;
    }
  }

  async onMessage(connection: unknown, message: unknown): Promise<void> {
    const doName = (this as unknown as { name?: string }).name ?? '<unnamed>';
    const conn = connection as { id?: string } | undefined;
    let envelopeType: string | undefined;
    if (typeof message === 'string') {
      // Only peek at the envelope `type` — never log full body content.
      const TYPE_REGEX = /"type"\s*:\s*"([^"]+)"/;
      const m = TYPE_REGEX.exec(message.slice(0, 200));
      envelopeType = m?.[1];
    }
    // Intercept our control frames before the SDK sees them (it doesn't
    // understand `flowlib.*`). Interrupt aborts the in-flight turn;
    // permission/HIL responses resolve the decision gate the provider awaits.
    if (typeof message === 'string' && envelopeType?.startsWith('flowlib.')) {
      if (this._handleControlFrame(message)) {
        return;
      }
    }
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] onMessage in', {
      doName,
      connectionId: conn?.id,
      messageType: typeof message,
      messageLen:
        typeof message === 'string'
          ? message.length
          : message instanceof ArrayBuffer
            ? message.byteLength
            : -1,
      envelopeType,
    });
    try {
      // @ts-expect-error see onConnect above.
      return await super.onMessage(connection, message);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] onMessage threw', {
        doName,
        connectionId: conn?.id,
        envelopeType,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      });
      throw err;
    }
  }

  async persistMessages(
    messages: unknown,
    excludeBroadcastIds?: unknown,
    options?: unknown,
  ): Promise<void> {
    const doName = (this as unknown as { name?: string }).name ?? '<unnamed>';
    const start = Date.now();
    const messageCount = Array.isArray(messages) ? messages.length : -1;
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] persistMessages in', {
      doName,
      messageCount,
    });
    try {
      // @ts-expect-error see onConnect above.
      const result = await super.persistMessages(messages, excludeBroadcastIds, options);
      // eslint-disable-next-line no-console
      console.log('[AgentChatDO] persistMessages out', {
        doName,
        messageCount,
        elapsedMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] persistMessages threw', {
        doName,
        messageCount,
        elapsedMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
        // If the underlying cause is a D1 timeout it shows up via `.cause`.
        causeMessage:
          err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
      });
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────

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
    const log = createConsoleSessionLogger('[AgentChatDO]');
    log.info('onChatMessage in', { messageCount: self.messages?.length ?? 0 });

    // Parse the DO name → orgId/sessionId (the runtime singleton is keyed
    // per isolate; the Worker fetch isolate is separate from this DO).
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

    let runtime;
    try {
      runtime = await ensureAgentsRuntime(
        (this as unknown as { env: unknown }).env,
        resolved.orgId,
      );
    } catch (err) {
      log.error('ensureAgentsRuntime failed', {
        orgId: resolved.orgId,
        message: err instanceof Error ? err.message : String(err),
      });
      this._emitError({
        message: err instanceof Error ? err.message : String(err),
        code: 'AGENT_RUNTIME_UNAVAILABLE',
      });
      return undefined;
    }
    const agentService = runtime.agentService as AgentService | undefined;
    if (!agentService) {
      this._emitError({
        message:
          'AgentService not registered on the agents runtime — it must register before ' +
          'any chat connection lands.',
        code: 'AGENT_SERVICE_MISSING',
      });
      return undefined;
    }

    const repositories = this._materializeRepositories(runtime);
    if (!repositories) {
      this._emitError({
        message: 'Repositories not registered on the agents runtime.',
        code: 'REPOSITORIES_MISSING',
      });
      return undefined;
    }

    const lastMessage = self.messages[self.messages.length - 1];
    const promptText = extractPromptText(lastMessage);
    if (!promptText) {
      this._emitError({
        message: 'No user-message text found in chat payload.',
        code: 'EMPTY_PROMPT',
      });
      return undefined;
    }

    // Abort source: the SDK's `options.abortSignal` OR our
    // `flowlib.interrupt` control frame (see `_handleControlFrame`).
    const abortController = new AbortController();
    this._activeAbort = abortController;
    if (options?.abortSignal) {
      const sig = options.abortSignal;
      if (sig.aborted) {
        abortController.abort();
      } else {
        sig.addEventListener('abort', () => abortController.abort());
      }
    }

    // Wrap `emit` with the silent-failure diagnostics the DO has always
    // logged (zero-events / session-end-with-error signatures).
    let emittedEvents = 0;
    const eventTypes: string[] = [];
    let lastSessionEnd: { type: 'session-end'; reason: string; error?: string } | undefined;
    const emit = (event: AgentEvent): void => {
      emittedEvents += 1;
      const evtType = (event as { type?: string }).type ?? 'unknown';
      eventTypes.push(evtType);
      if (evtType === 'session-end') {
        lastSessionEnd = event as typeof lastSessionEnd;
      }
      this._emitAgentEvent(event);
    };

    // Lazy-init the per-instance cache + gate (field initializers don't
    // run under the SDK base constructor / `Object.create`).
    this._promptCache ??= createInMemoryPromptCache();
    this._decisionGate ??= createDecisionGate();

    const deps: ChatHostDeps & { agentService: AgentService } = {
      sessionId: resolved.sessionId,
      orgId: resolved.orgId,
      auth: resolved.auth,
      providers: runtime.providers,
      workspaces: runtime.workspaces,
      hookPipeline: (runtime as { hookPipeline?: ChatHostDeps['hookPipeline'] }).hookPipeline,
      permissions: runtime.permissions as ChatHostDeps['permissions'],
      credentials: (runtime as { credentials?: ChatHostDeps['credentials'] }).credentials,
      eagerWorkspace: (runtime as { eagerWorkspace?: boolean }).eagerWorkspace === true,
      subAgents: (runtime as { subAgents?: boolean }).subAgents === true,
      ...((runtime as { webSearch?: ChatHostDeps['webSearch'] }).webSearch
        ? { webSearch: (runtime as { webSearch?: ChatHostDeps['webSearch'] }).webSearch }
        : {}),
      mcpClientFactory: mcpClientFactory(),
      repositories,
      emit,
      logger: log,
      abortSignal: abortController.signal,
      promptCache: this._promptCache,
      decisionGate: this._decisionGate,
      agentService,
    };

    log.info('runTurn start', {
      sessionId: resolved.sessionId,
      promptLen: promptText.length,
    });
    const runTurnStart = Date.now();
    try {
      const outcome = await runChatTurn(deps, promptText);
      if ('error' in outcome) {
        this._emitError(outcome.error);
        return undefined;
      }
      const result = outcome.result;
      log.info('runTurn done', {
        sessionId: resolved.sessionId,
        reason: result.reason,
        events: emittedEvents,
        eventTypes,
        error: result.error ?? lastSessionEnd?.error ?? null,
        inputTokens: result.inputTokensTotal,
        outputTokens: result.outputTokensTotal,
        durationMs: Date.now() - runTurnStart,
      });
      // A "normal" turn that produced zero events is the canonical
      // silent-failure case — surface it explicitly.
      if (emittedEvents === 0) {
        log.warn('runTurn produced zero AgentEvents — provider likely failed before streaming.', {
          sessionId: resolved.sessionId,
        });
        this._emitError({
          message:
            'Agent turn completed without producing any output. The LLM provider likely ' +
            'failed before streaming (missing or unmapped API key). Check the credentials ' +
            'for this org and the workspace sandbox process logs.',
          code: 'RUN_TURN_NO_EVENTS',
        });
      }
      await onFinish({
        finishReason: result.reason,
        usage: { inputTokens: result.inputTokensTotal, outputTokens: result.outputTokensTotal },
      });
    } catch (err) {
      log.error('runTurn threw', {
        sessionId: resolved.sessionId,
        durationMs: Date.now() - runTurnStart,
        message: err instanceof Error ? err.message : String(err),
      });
      this._emitError({
        message: err instanceof Error ? err.message : String(err),
        code: 'RUN_TURN_FAILED',
      });
    } finally {
      this._activeAbort = null;
      // Unblock any provider awaits left dangling on the gate.
      this._decisionGate?.rejectAll(new Error('turn ended'));
    }
    return undefined;
  }

  /**
   * Materialise the repositories bag from the runtime singleton. The
   * slot is normally a *factory* (installed by `registerRepositories`)
   * keyed by a `PluginDatabaseApi`; tests may stash a ready bag directly.
   */
  private _materializeRepositories(runtime: { repositories?: unknown }): RepositoriesBag | null {
    const slot = runtime.repositories as unknown;
    if (typeof slot === 'function') {
      const factory = slot as (db: ReturnType<typeof getAgentsDatabaseApi>) => RepositoriesBag;
      return factory(getAgentsDatabaseApi());
    }
    if (slot && typeof slot === 'object') {
      return slot as RepositoriesBag;
    }
    return null;
  }

  /**
   * Route an inbound `flowlib.*` control frame the Agents SDK doesn't
   * understand. Returns `true` when handled (so `onMessage` short-circuits
   * before `super.onMessage`).
   */
  private _handleControlFrame(raw: string): boolean {
    let frame: { type?: string; id?: string; decision?: unknown; response?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return false;
    }
    switch (frame.type) {
      case 'flowlib.interrupt':
        this._activeAbort?.abort();
        return true;
      case 'flowlib.permission-response':
        if (typeof frame.id === 'string') {
          this._decisionGate?.resolvePermission(frame.id, frame.decision);
        }
        return true;
      case 'flowlib.hil-response':
        if (typeof frame.id === 'string') {
          this._decisionGate?.resolveHumanInput(frame.id, frame.response);
        }
        return true;
      default:
        return false;
    }
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
