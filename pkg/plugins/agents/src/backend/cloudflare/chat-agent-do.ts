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

import { ensureAgentsRuntime, getAgentsDatabaseApi } from './runtime-singleton';
import { composeSystemPrompt } from '../prompt/compose';

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
   * The composed system prompt for this session, cached for the DO
   * instance's lifetime. `composeSystemPrompt` is meant to run once at
   * session start (per its own docs); `_buildSessionContext` runs every
   * turn, so we memoise here keyed by sessionId. Recomputed on DO
   * eviction/restart — acceptable for v1; a mid-session config edit
   * (systemPrompt/denyList) takes effect on the next cold DO.
   */
  private _composedPrompt?: { sessionId: string; prompt: string };

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
    const doName = (this as unknown as { name?: string }).name ?? '<unnamed>';
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] onChatMessage in', {
      doName,
      messageCount: self.messages?.length ?? 0,
    });

    // Parse the DO name first so we have an orgId to hand to the
    // bootstrap. The Worker fetch isolate and each DO isolate are
    // separate, so the host's `createFlowlib({ plugins: [agents(...)] })`
    // call has *not* populated the runtime singleton in this isolate
    // unless the host registered a bootstrapper at module load time.
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
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] ensureAgentsRuntime failed', {
        doName,
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
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] agentService missing on runtime singleton', {
        doName,
        runtimeKeys: Object.keys(runtime ?? {}),
      });
      this._emitError({
        message:
          'AgentService not registered on the agents runtime — Stream A ' +
          'must register before any chat connection lands.',
        code: 'AGENT_SERVICE_MISSING',
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
      // Plumb the session row's stored model id through to the provider.
      // Without this, the opencode provider falls back to its factory
      // default (historically a hyphenated id that opencode/OpenRouter
      // don't recognise → silent 200/empty → chat hang).
      model: sessionContext.defaultModel,
    };
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] promptInput', {
      providerSessionId: promptInput.providerSessionId,
      model: promptInput.model,
      partsCount: promptInput.parts.length,
    });

    // Counter so we can log "runTurn finished with N events emitted" —
    // a `result.reason: 'stop'` with `events: 0` is the silent-failure
    // signature. Also collect a summary of event types so the
    // canonical "1 event emitted, reason='error'" pattern (which is
    // the kernel's session-end-with-error path) carries enough info
    // to debug from the log alone.
    let emittedEvents = 0;
    const eventTypes: string[] = [];
    let lastSessionEnd: { type: 'session-end'; reason: string; error?: string } | undefined;
    const originalEmit = sessionContext.emit;
    sessionContext.emit = (event) => {
      emittedEvents += 1;
      const evtType = (event as { type?: string }).type ?? 'unknown';
      eventTypes.push(evtType);
      if (evtType === 'session-end') {
        lastSessionEnd = event as typeof lastSessionEnd;
      }
      originalEmit(event);
    };

    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] runTurn start', {
      sessionId: resolved.sessionId,
      providerSessionId: sessionContext.providerSessionId,
      promptLen: promptText.length,
    });
    const runTurnStart = Date.now();

    try {
      const result = await agentService.runTurn(sessionContext, promptInput);
      // eslint-disable-next-line no-console
      console.log('[AgentChatDO] runTurn done', {
        sessionId: resolved.sessionId,
        reason: result.reason,
        events: emittedEvents,
        eventTypes,
        // `result.error` is the kernel's `endError` — populated when
        // the provider stream threw, the iterator's first event was
        // an error, a hook short-circuited, etc. Logging it here is
        // the *only* way to surface the underlying message: the kernel
        // packs it into the `session-end` event but we'd otherwise
        // need to reach into our event accumulator to find it.
        error: result.error ?? lastSessionEnd?.error ?? null,
        inputTokens: result.inputTokensTotal,
        outputTokens: result.outputTokensTotal,
        durationMs: Date.now() - runTurnStart,
      });
      // A turn that completed "normally" but produced zero events is
      // the canonical silent-failure case. Surface it explicitly so
      // the WS client (and `wrangler tail`) gets a signal instead of
      // the SDK's `[AIChatAgent] onChatMessage returned no response`
      // warning being the only clue.
      if (emittedEvents === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          '[AgentChatDO] runTurn produced zero AgentEvents — provider likely failed before streaming. ' +
            'Check the workspace sandbox process logs and the opencode provider config (e.g. loadProviderConfig).',
          {
            sessionId: resolved.sessionId,
            providerSessionId: sessionContext.providerSessionId,
          },
        );
        this._emitError({
          message:
            'Agent turn completed without producing any output. The LLM provider ' +
            'inside the workspace sandbox likely failed before streaming (missing or ' +
            'unmapped API key). Check the credentials for this org and the workspace ' +
            'sandbox process logs.',
          code: 'RUN_TURN_NO_EVENTS',
        });
      }
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
      // eslint-disable-next-line no-console
      console.error('[AgentChatDO] runTurn threw', {
        sessionId: resolved.sessionId,
        durationMs: Date.now() - runTurnStart,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
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
    const runtime = await ensureAgentsRuntime(
      (this as unknown as { env: unknown }).env,
      resolved.orgId,
    );
    // `runtime.repositories` is normally the *factory* installed by
    // `registerRepositories(ctx)`. Materialise the bag by calling the
    // factory with a `PluginDatabaseApi` bound to this isolate's
    // Flowlib instance. Tests that pre-build a repositories bag and
    // stash it directly via `setAgentsRuntime` can still pass — we
    // detect that shape by checking for `typeof === 'function'`.
    type RepositoriesBag = {
      sessions: { findById(id: string): Promise<unknown> };
      workspaces?: { findById(id: string, orgId: string): Promise<unknown> };
      messages?: { append?: (input: unknown) => Promise<void> };
    };
    const reposSlot = runtime.repositories as unknown;
    let repositories: RepositoriesBag;
    if (typeof reposSlot === 'function') {
      const factory = reposSlot as (db: ReturnType<typeof getAgentsDatabaseApi>) => RepositoriesBag;
      repositories = factory(getAgentsDatabaseApi());
    } else if (reposSlot && typeof reposSlot === 'object') {
      repositories = reposSlot as RepositoriesBag;
    } else {
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
          credentialId?: string | null;
          model?: string | null;
          // Session config the DO previously dropped (the §0 "shared
          // root cause" narrowing). Read them here so they can be
          // threaded to the provider / composer. `enabledMcpServerIds`
          // + `permissionMode` are read for completeness; they're
          // consumed by the MCP-resolution (§3) and permission-prompt
          // work respectively, landing in follow-up slices.
          systemPrompt?: string | null;
          denyList?: string[] | null;
          enabledMcpServerIds?: string[] | null;
          permissionMode?: string | null;
        }
      | undefined;

    if (!sessionRow) {
      this._emitError({
        message: `Session ${resolved.sessionId} not found`,
        code: 'SESSION_NOT_FOUND',
      });
      return null;
    }
    // eslint-disable-next-line no-console
    console.log('[AgentChatDO] sessionRow', {
      sessionId: resolved.sessionId,
      providerId: sessionRow.providerId,
      providerSessionId: sessionRow.providerSessionId,
      workspaceId: sessionRow.workspaceId,
      credentialId: sessionRow.credentialId,
      model: sessionRow.model,
    });
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

    // ── Workspace rehydration ──
    //
    // The original `POST /sessions` call resolved the workspace handle
    // in the fetch isolate; that resolution stayed there as part of
    // the provider's per-session state. This DO is a separate isolate
    // (DO instances do not share an isolate with the Worker fetch
    // handler), so we have to re-resolve here so the provider can
    // be rehydrated below.
    let workspaceHandle: { metadata?: Record<string, unknown> } | undefined;
    if (sessionRow.workspaceId && repositories.workspaces) {
      try {
        const wsRow = (await repositories.workspaces.findById(
          sessionRow.workspaceId,
          resolved.orgId,
        )) as { workspaceProviderId?: string } | undefined;
        if (wsRow?.workspaceProviderId) {
          const wsProvider = runtime.workspaces?.get(wsRow.workspaceProviderId);
          if (wsProvider) {
            workspaceHandle = (await wsProvider.resolve(sessionRow.workspaceId, resolved.auth)) as {
              metadata?: Record<string, unknown>;
            };
          } else {
            // eslint-disable-next-line no-console
            console.warn('[AgentChatDO] workspace provider not registered in this isolate', {
              workspaceProviderId: wsRow.workspaceProviderId,
            });
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[AgentChatDO] workspace rehydrate failed', {
          workspaceId: sessionRow.workspaceId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Provider rehydration ──
    //
    // Providers keep per-session state in module-scoped Maps that are
    // populated during `createSession` (e.g. opencode's `sessionsById`).
    // Those Maps are per-isolate; they're empty in a fresh DO isolate
    // even when the row exists in D1. Calling `provider.createSession`
    // again with the existing `providerSessionId` is the rehydration
    // path — providers that recognise the field treat it as idempotent
    // and only populate state when missing.
    // ── System-prompt composition ──
    //
    // Build the effective system prompt from the session's config. Until
    // now the provider received the raw `agent_sessions.systemPrompt`
    // string and the whole compose layer (operating directives, deny-list
    // mention, and the slots for skills / memory / workspace context) was
    // dormant — see plans/agents §0. We compose here and feed the result
    // into `createSession`, which the provider stores as the session's
    // system prompt.
    const effectiveSystemPrompt = await this._composeEffectiveSystemPrompt(resolved.sessionId, {
      systemPrompt: sessionRow.systemPrompt,
      denyList: sessionRow.denyList,
    });

    try {
      await provider.createSession({
        auth: resolved.auth,
        config: {},
        workspace: workspaceHandle as never,
        credentialId: sessionRow.credentialId ?? undefined,
        providerSessionId: sessionRow.providerSessionId,
        systemPrompt: effectiveSystemPrompt,
      } as never);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[AgentChatDO] provider rehydrate failed', {
        providerId: sessionRow.providerId,
        providerSessionId: sessionRow.providerSessionId,
        message: err instanceof Error ? err.message : String(err),
      });
      // Fall through — if the provider truly doesn't have the session
      // state, `prompt()` will yield an "unknown session id" event and
      // the kernel will surface it as `RUN_TURN_NO_EVENTS` / a session
      // -end-with-error event the existing logging captures.
    }

    const hooks =
      (runtime.hookPipeline as SessionContext['hooks'] | undefined) ?? noopHookPipeline();
    const permissions =
      (runtime.permissions as SessionContext['permissions'] | undefined) ?? allowAllPermissions();
    const callbacks = buildPersistenceCallbacks(repositories);
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
      workspace: workspaceHandle as never,
      hooks,
      permissions,
      logger: createSessionLogger(this),
      callbacks,
      emit: (event: AgentEvent) => {
        this._emitAgentEvent(event);
      },
      abortSignal: abortController.signal,
      // Pull the per-session model off the D1 row so the provider's
      // prompt() sees the **user's choice** (e.g.
      // `openrouter/anthropic/claude-sonnet-4.5`). Without this, the
      // provider falls back to its factory `defaultModel` which is
      // hardcoded and was historically a hyphenated Anthropic-native id
      // (`anthropic/claude-sonnet-4-5`) — opencode silently accepts a
      // prompt with an unknown model and returns 200/empty, making the
      // whole chat hang. See failure mode #11 in AGENTS-DEBUGGING.md.
      defaultModel: sessionRow.model ?? undefined,
    };
  }

  /**
   * Compose the effective system prompt for the session, memoised for
   * the DO instance's lifetime (see `_composedPrompt`).
   *
   * Today it feeds the base system prompt + deny-list mention +
   * always-on operating directives. The skills, memory, available-tools,
   * and workspace-context / CLAUDE.md sections are wired as empty slots
   * and fill in as those subsystems land (plans/agents §1, §2, §4). The
   * workspace/CLAUDE.md walk is deferred for sandbox workspaces: their
   * handles expose no `rootPath` and the walk would add a per-turn
   * container round-trip.
   */
  private async _composeEffectiveSystemPrompt(
    sessionId: string,
    row: { systemPrompt?: string | null; denyList?: string[] | null },
  ): Promise<string> {
    if (this._composedPrompt && this._composedPrompt.sessionId === sessionId) {
      return this._composedPrompt.prompt;
    }
    const prompt = await composeSystemPrompt({
      systemPrompt: row.systemPrompt ?? '',
      skillSummaries: [],
      denyList: row.denyList ?? [],
      availableTools: [],
      memory: [],
      attachments: [],
    });
    this._composedPrompt = { sessionId, prompt };
    return prompt;
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
function buildPersistenceCallbacks(repositories: {
  messages?: { append?: (input: unknown) => Promise<void> };
}): PersistenceCallbacks {
  const append = repositories?.messages?.append;

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
