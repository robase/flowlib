/**
 * `openCodeProvider` — `AgentProvider` backed by `@opencode-ai/sdk`.
 *
 * **Security posture (important):** opencode does NOT have a synchronous
 * `canUseTool`-style PreToolUse callback the way Claude Code does. The deny
 * enforcement implemented here runs at the SSE event-stream layer — when a
 * `tool_use` event arrives that hits a deny rule, we abort the session and
 * inject a synthetic error tool-result. This is genuinely weaker than a
 * pre-execution hook: by the time we abort, `Write` or `Bash` may have
 * already started side-effects.
 *
 * **In v1 the actual security boundary is the `cloudflareSandbox`
 * container** (Stream E) that wraps opencode. The hook layer is telemetry
 * / redaction only. We surface this honestly via
 * `capabilities.permissionPrompts: false` so consumers know the HIL
 * permission UI is not available for opencode sessions.
 *
 * **Modes** (factory option `mode`):
 *
 *   - `'sandbox'` (auto-selected when the workspace is a `cloudflareSandbox`):
 *     uses `@cloudflare/sandbox/opencode`'s `createOpencode()` via
 *     `workspace.metadata.getOpencode`. The transport routes through
 *     `sandbox.containerFetch`, so SDK traffic never leaves the Worker
 *     and the helper handles container cold-start + port readiness
 *     internally — no `exposePort`, no preview-URL DNS, no boot-race
 *     retries.
 *   - `'external'`: `createOpencodeClient({ baseUrl })` against a
 *     long-running external `opencode serve`. The baseUrl resolves from
 *     (in priority order) `extras.baseUrl`, factory `baseUrl`, or
 *     `$OPENCODE_BASE_URL`. Used when ops manages OpenCode out-of-band.
 *   - `'embedded'`: `createOpencode()` — starts an in-process opencode
 *     server. Cached per workspace `directory`; many sessions share one
 *     server. Useful for local dev.
 *
 * **Streaming**: `prompt()` opens an SSE event stream
 * (`client.event.subscribe`) **before** firing `client.session.prompt` so
 * we don't miss the first event. Events are filtered by sessionID, mapped
 * via `mapOpencodeEvent`, and yielded. The stream terminates on
 * `session.idle` / `session.error` (which yield a `message-complete` /
 * `session-end`), or when `abortSignal.aborted` flips.
 *
 * **Tool-deny enforcement**: the provider passes `enabledTools` /
 * `extraDenied` down via the `tools` flag map on `session.prompt`. For
 * "hard" denies we also intercept tool-call events at the SSE layer and
 * call `client.session.abort()` the moment a denied tool fires; the
 * synthetic error tool-result keeps the iterator's bookkeeping consistent.
 */

import type {
  AgentProvider,
  AgentCapabilities,
  AgentProviderConfig,
  CreateSessionInput,
  PromptInput,
  ListMessagesInput,
  AgentProviderMessage,
  AgentModel,
} from '../types';
import { randomBytes } from 'node:crypto';
import type { AgentEvent } from '../../../shared/events';
import type { WorkspaceHandle } from '../../workspaces/types';
import { FLOWLIB_SESSION_HEADER, type OutboundVendor } from '../../cloudflare/outbound-auth';
import { createMapperState, mapOpencodeEvent, type OpencodeEvent } from './events';
import {
  buildToolsMap,
  clearClientCache,
  clearEmbeddedCache,
  getClient,
  getClientForMode,
  getEmbedded,
  splitModelId,
  unwrapSessionId,
  type OpencodeClientLike,
  type OpencodeMode,
} from './runtime';

// ─── Capabilities (static) ──────────────────────────────────────────────

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  mcpServers: true,
  parallelToolCalls: true,
  fileEdits: true,
  /**
   * opencode itself doesn't surface stable resumable event ids; the
   * Cloudflare DO transport buffers events on top of this provider, so
   * end-user resume still works in CF mode. Marked false here as an
   * accurate reflection of the provider's native capability.
   */
  resumableStream: false,
  workspaceRequired: true,
  /**
   * No `canUseTool`-style synchronous prompt callback. The frontend
   * shows a posture badge for opencode agents in high-trust roles; the
   * sandbox is the security boundary.
   */
  permissionPrompts: false,
  // Opencode requires the `opencode` CLI in the sandbox image; the
  // standard `cloudflareSandbox` provider boots it via
  // `@cloudflare/sandbox/opencode`.
  preferredWorkspaceProviderId: 'cloudflare-sandbox',
};

// ─── Per-session state ─────────────────────────────────────────────────

/**
 * State kept per provider session id. opencode is HTTP, so we don't hold
 * a persistent SDK object — we just remember the resolved baseUrl /
 * directory / agent-config so subsequent `prompt()` calls don't need to
 * re-resolve from the workspace.
 */
interface SessionState {
  /** Connection mode at session-create time (sticks for the session's life). */
  mode: OpencodeMode;
  /** Resolved baseUrl (external) or embedded server URL. May be undefined for sandbox-mode where the SDK transports through `containerFetch`. */
  baseUrl?: string;
  directory?: string;
  /** Workspace handle — kept so subsequent `prompt()` calls can re-resolve the sandbox-mode client without re-running creation. */
  workspace?: WorkspaceHandle;
  defaultModel?: string;
  systemPrompt?: string;
  /**
   * Auth context captured at create time — needed by the lazy boot path
   * (sandbox mode) so `loadProviderConfig` can gather org-scoped LLM
   * credentials.
   */
  auth?: CreateSessionInput['auth'];
  /**
   * Credential id selected by the user for this session, if any. Used
   * for audit/billing attribution; the actual provider routing is
   * driven by the model id.
   */
  credentialId?: string;
  /**
   * Title to use when we lazily call upstream `client.session.create`.
   * Captured so the chat title we picked at API time is preserved when
   * the upstream session finally gets created.
   */
  title: string;
  /** Extras passed to createSession — replayed when we lazily create the upstream session. */
  extras?: Record<string, unknown>;
  /**
   * Upstream opencode session id, populated lazily on the first
   * `prompt()` call. Until then we operate on the placeholder id we
   * returned from `createSession` (stored as the row's
   * `provider_session_id`).
   */
  upstreamSessionId: string | null;
  /**
   * In-flight lazy-boot promise — coalesces concurrent prompts so we
   * don't create two upstream sessions for the same placeholder.
   */
  upstreamSessionPromise?: Promise<string>;
}

const sessionsById = new Map<string, SessionState>();

// ─── Config validation ─────────────────────────────────────────────────

interface OpenCodeConfig {
  /** Per-agent default model override. Falls back to the factory default. */
  defaultModel?: string;
  /** Per-agent system prompt override. Composed with Stream K's prompt. */
  systemPrompt?: string;
  /** Provider-tied default deny list (merged with role denies at prompt-time). */
  defaultDenied?: string[];
  /** Optional baseUrl pin for testing. Production sets this on the workspace. */
  baseUrl?: string;
  /** Per-agent connection mode override. Defaults to the factory mode. */
  mode?: OpencodeMode;
}

function validateOpenCodeConfig(config: unknown): AgentProviderConfig {
  if (config === undefined || config === null) {
    return {};
  }
  if (typeof config !== 'object') {
    throw new Error('[agents/opencode] provider config must be an object');
  }
  const c = config as Record<string, unknown>;

  const result: OpenCodeConfig = {};
  if (c.defaultModel !== undefined) {
    if (typeof c.defaultModel !== 'string') {
      throw new Error(
        '[agents/opencode] defaultModel must be a string (e.g. "anthropic/claude-sonnet-4-7")',
      );
    }
    result.defaultModel = c.defaultModel;
  }
  if (c.systemPrompt !== undefined) {
    if (typeof c.systemPrompt !== 'string') {
      throw new Error('[agents/opencode] systemPrompt must be a string');
    }
    result.systemPrompt = c.systemPrompt;
  }
  if (c.defaultDenied !== undefined) {
    if (!Array.isArray(c.defaultDenied) || !c.defaultDenied.every((t) => typeof t === 'string')) {
      throw new Error('[agents/opencode] defaultDenied must be an array of tool name strings');
    }
    result.defaultDenied = c.defaultDenied as string[];
  }
  if (c.baseUrl !== undefined) {
    if (typeof c.baseUrl !== 'string') {
      throw new Error('[agents/opencode] baseUrl must be a string');
    }
    result.baseUrl = c.baseUrl;
  }
  if (c.mode !== undefined) {
    if (c.mode !== 'embedded' && c.mode !== 'external') {
      throw new Error('[agents/opencode] mode must be "embedded" or "external"');
    }
    result.mode = c.mode;
  }
  return result as AgentProviderConfig;
}

// ─── Provider factory ──────────────────────────────────────────────────

export interface OpenCodeProviderOptions {
  /**
   * Default model for sessions that don't override it. Format:
   * `"providerID/modelID"`, e.g. `"anthropic/claude-sonnet-4-7"`.
   */
  defaultModel?: string;
  /**
   * Connection mode. When unset the provider auto-selects `'sandbox'`
   * if the workspace exposes `metadata.getOpencode` (i.e. it's a
   * `cloudflareSandbox`), and falls back to `'external'` otherwise.
   *
   *   - `'sandbox'`: use `@cloudflare/sandbox/opencode`'s `createOpencode()`
   *     via the workspace's `getOpencode` helper. The v1 production posture.
   *   - `'external'`: `createOpencodeClient({ baseUrl })` against an
   *     external `opencode serve`. baseUrl resolves from `extras.baseUrl`,
   *     factory `baseUrl`, or `$OPENCODE_BASE_URL`.
   *   - `'embedded'`: in-process server via the SDK's `createOpencode()`.
   *     Useful for local dev or single-tenant non-CF deployments.
   */
  mode?: OpencodeMode;
  /**
   * Optional fixed baseUrl for external mode — used when ops runs an
   * `opencode serve` instance independent of any workspace.
   */
  baseUrl?: string;
  /**
   * Default tool deny list applied to every session — useful for posture
   * defaults. Merges with per-agent `defaultDenied` and per-prompt
   * `extraDenied`.
   */
  defaultDenied?: ReadonlyArray<string>;
  /**
   * Async loader that returns the OpenCode `Config.provider` map for a
   * given org. Wired by the host to `flowlib.credentials` — the
   * agents plugin gathers every active `type: 'llm'` credential for
   * the org, decrypts each, and translates them into the opencode
   * provider config. Per the v1 design, OpenCode boots once per
   * workspace with the union of all the org's keys; per-session
   * routing then happens via the model id.
   *
   * The loader receives the per-session `credentialId` for audit /
   * future filtering, but the returned config should reflect the
   * full org-wide key set so the user can switch models freely.
   */
  loadProviderConfig?: (input: {
    auth: CreateSessionInput['auth'];
    credentialId?: string;
  }) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

export function openCodeProvider(options: OpenCodeProviderOptions = {}): AgentProvider {
  const factoryDefaultModel = options.defaultModel;
  const factoryMode: OpencodeMode | undefined = options.mode;
  const factoryBaseUrl = options.baseUrl;
  const factoryDefaultDenied = options.defaultDenied ?? [];
  const loadProviderConfig = options.loadProviderConfig;

  function newPlaceholderSessionId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID?.() ?? `oc-pending-${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  /**
   * Lazily ensure the upstream opencode session exists for the given
   * placeholder id. Idempotent — concurrent callers share the same
   * in-flight promise; the resolved upstream id is cached on
   * `session.upstreamSessionId`.
   *
   * Returns the resolved upstream id usable with `client.session.*`,
   * plus the live OpencodeClient (so callers don't have to re-resolve).
   */
  async function ensureUpstream(
    placeholderId: string,
  ): Promise<{ session: SessionState; upstreamId: string; client: OpencodeClientLike }> {
    const t0 = Date.now();
    const session = sessionsById.get(placeholderId);
    if (!session) {
      throw new Error(`[agents/opencode] unknown session id ${placeholderId}`);
    }
    // eslint-disable-next-line no-console
    console.log('[agents/opencode] ensureUpstream enter', {
      placeholderId,
      mode: session.mode,
      hasUpstreamId: Boolean(session.upstreamSessionId),
      hasInFlight: Boolean(session.upstreamSessionPromise),
      directory: session.directory,
      title: session.title,
    });
    if (!session.upstreamSessionPromise && !session.upstreamSessionId) {
      session.upstreamSessionPromise = (async () => {
        // OpenCode `Config.provider` to pass to the workspace's
        // `getOpencode`. Three flows:
        //   1. Sandbox + outboundAuth on workspace metadata → boot with
        //      placeholder API keys + a session-id header. The Worker's
        //      outbound handlers inject the real keys at request time.
        //      The container never sees credentials.
        //   2. Sandbox without outboundAuth → fall back to the legacy
        //      "load all org credentials, bake into Config.provider"
        //      path via `loadProviderConfig`.
        //   3. External / embedded mode → no provider config needed
        //      from this layer.
        let providerCfg: Record<string, unknown> | undefined;
        const outboundMode = session.mode === 'sandbox' && hasOutboundAuth(session.workspace);
        // eslint-disable-next-line no-console
        console.log('[agents/opencode] provider config branch', {
          placeholderId,
          mode: session.mode,
          outboundMode,
          hasLoadProviderConfig: Boolean(loadProviderConfig),
          hasAuth: Boolean(session.auth),
        });
        if (outboundMode) {
          providerCfg = buildOutboundProviderConfig(placeholderId);
          // eslint-disable-next-line no-console
          console.log('[agents/opencode] built outbound provider config', {
            placeholderId,
            vendors: Object.keys(providerCfg),
          });
        } else if (session.mode === 'sandbox' && loadProviderConfig && session.auth) {
          try {
            // eslint-disable-next-line no-console
            console.log('[agents/opencode] calling loadProviderConfig…', { placeholderId });
            const loaded = await loadProviderConfig({
              auth: session.auth,
              credentialId: session.credentialId,
            });
            providerCfg = loaded ?? undefined;
            // eslint-disable-next-line no-console
            console.log('[agents/opencode] loadProviderConfig returned', {
              placeholderId,
              vendors: providerCfg ? Object.keys(providerCfg) : null,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.error('[agents/opencode] loadProviderConfig threw', {
              placeholderId,
              message,
            });
            throw new Error(`[agents/opencode] loadProviderConfig failed: ${message}`);
          }
        }
        // eslint-disable-next-line no-console
        console.log('[agents/opencode] calling getClientForMode…', {
          placeholderId,
          mode: session.mode,
          elapsedMs: Date.now() - t0,
        });
        const { client, baseUrl } = await getClientForMode({
          mode: session.mode,
          workspace: session.workspace,
          extras: { ...session.extras },
          factoryBaseUrl,
          opencodeOverride: providerCfg ? { config: { provider: providerCfg } } : undefined,
        });
        // eslint-disable-next-line no-console
        console.log('[agents/opencode] getClientForMode resolved', {
          placeholderId,
          baseUrl,
          elapsedMs: Date.now() - t0,
        });
        let resp: unknown;
        try {
          // eslint-disable-next-line no-console
          console.log('[agents/opencode] calling client.session.create…', {
            placeholderId,
            title: session.title,
            directory: session.directory,
            elapsedMs: Date.now() - t0,
          });
          resp = await client.session.create({
            title: session.title,
            ...(session.directory ? { directory: session.directory } : {}),
          });
          // eslint-disable-next-line no-console
          console.log('[agents/opencode] client.session.create resolved', {
            placeholderId,
            elapsedMs: Date.now() - t0,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error('[agents/opencode] client.session.create threw', {
            placeholderId,
            mode: session.mode,
            target: baseUrl ?? '<unknown>',
            elapsedMs: Date.now() - t0,
            message,
          });
          throw new Error(
            `[agents/opencode] session.create failed (mode=${session.mode}, target=${baseUrl ?? '<unknown>'}): ${message}`,
          );
        }
        const upstreamId = unwrapSessionId(resp);
        session.upstreamSessionId = upstreamId;
        session.baseUrl = baseUrl;
        // eslint-disable-next-line no-console
        console.log('[agents/opencode] upstream booted', {
          placeholderId,
          upstreamId,
          baseUrl,
          totalElapsedMs: Date.now() - t0,
        });
        return upstreamId;
      })().catch((err) => {
        // Allow retry on the next call if boot fails.
        session.upstreamSessionPromise = undefined;
        throw err;
      });
    }
    const upstreamId =
      session.upstreamSessionId ??
      (session.upstreamSessionPromise ? await session.upstreamSessionPromise : undefined);
    if (!upstreamId) {
      throw new Error('opencode: failed to resolve upstream session id');
    }
    const client = await resolveSessionClient(session);
    // eslint-disable-next-line no-console
    console.log('[agents/opencode] ensureUpstream done', {
      placeholderId,
      upstreamId,
      totalElapsedMs: Date.now() - t0,
    });
    return { session, upstreamId, client };
  }

  /**
   * Resolve the effective mode. Per-call overrides (extras / config)
   * take precedence; otherwise we auto-pick `'sandbox'` when the
   * workspace exposes `metadata.getOpencode` and `'external'` otherwise.
   */
  const resolveMode = (input: {
    extras?: Record<string, unknown>;
    cfg: OpenCodeConfig;
    workspace?: CreateSessionInput['workspace'];
  }): OpencodeMode => {
    const fromExtras =
      typeof input.extras?.mode === 'string' ? (input.extras.mode as OpencodeMode) : undefined;
    if (fromExtras) {
      return fromExtras;
    }
    if (input.cfg.mode) {
      return input.cfg.mode;
    }
    if (factoryMode) {
      return factoryMode;
    }
    const meta = input.workspace?.metadata as { getOpencode?: unknown } | undefined;
    return meta && typeof meta.getOpencode === 'function' ? 'sandbox' : 'external';
  };

  return {
    id: 'opencode',
    name: 'opencode',
    icon: 'Code2',
    capabilities: OPENCODE_CAPABILITIES,

    validateConfig: validateOpenCodeConfig,

    async createSession(input: CreateSessionInput): Promise<{ providerSessionId: string }> {
      const cfg = (input.config ?? {}) as OpenCodeConfig;
      const directory = input.workspace?.rootPath;
      const mode = resolveMode({ extras: input.extras, cfg, workspace: input.workspace });

      const titleExtra = input.extras?.title;
      const title = typeof titleExtra === 'string' ? titleExtra : `flowlib-${Date.now()}`;

      // 522 fix: do NOT boot opencode or call `client.session.create`
      // synchronously here. Container cold-start + opencode boot can
      // exceed the Worker request budget (~100s on Cloudflare's edge).
      // Return a placeholder id immediately and lazily provision the
      // upstream session on the first `prompt()`. The placeholder is
      // what the DB row's `provider_session_id` stores; the chat WS DO
      // calls `prompt()` which does the boot + upstream `session.create`
      // once, then caches the upstream id for subsequent turns.
      //
      // Idempotency: when `input.providerSessionId` is supplied the
      // caller is asking for **rehydration** — typically because we're
      // inside a fresh Durable Object isolate that didn't run the
      // original `createSession`, so `sessionsById` in this isolate is
      // empty even though a row exists in D1. If the entry already
      // exists in this isolate, no-op. Otherwise populate `sessionsById`
      // with that exact id rather than minting a new one.
      const placeholderId = input.providerSessionId ?? newPlaceholderSessionId();
      if (input.providerSessionId && sessionsById.has(input.providerSessionId)) {
        return { providerSessionId: input.providerSessionId };
      }
      sessionsById.set(placeholderId, {
        mode,
        directory,
        workspace: input.workspace,
        auth: input.auth,
        credentialId: input.credentialId,
        title,
        extras: input.extras,
        defaultModel: cfg.defaultModel ?? factoryDefaultModel,
        systemPrompt: cfg.systemPrompt ?? input.systemPrompt,
        upstreamSessionId: null,
      });

      return { providerSessionId: placeholderId };
    },

    async *prompt(input: PromptInput): AsyncIterable<AgentEvent> {
      const promptStart = Date.now();
      // eslint-disable-next-line no-console
      console.log('[agents/opencode] prompt enter', {
        providerSessionId: input.providerSessionId,
        model: input.model,
        partsCount: input.parts.length,
        knownSession: sessionsById.has(input.providerSessionId),
      });
      if (!sessionsById.has(input.providerSessionId)) {
        // eslint-disable-next-line no-console
        console.error('[agents/opencode] prompt → unknown session id, yielding error', {
          providerSessionId: input.providerSessionId,
        });
        yield {
          type: 'session-end',
          reason: 'error',
          error: `[agents/opencode] unknown session id ${input.providerSessionId} — call createSession first`,
        };
        return;
      }

      let upstreamHandle: { session: SessionState; upstreamId: string; client: OpencodeClientLike };
      try {
        upstreamHandle = await ensureUpstream(input.providerSessionId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[agents/opencode] ensureUpstream threw — yielding error', {
          providerSessionId: input.providerSessionId,
          elapsedMs: Date.now() - promptStart,
          message: err instanceof Error ? err.message : String(err),
        });
        yield {
          type: 'session-end',
          reason: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
        return;
      }
      const { session, upstreamId, client } = upstreamHandle;
      const { directory, defaultModel, systemPrompt } = session;
      // eslint-disable-next-line no-console
      console.log('[agents/opencode] resolved upstream', {
        providerSessionId: input.providerSessionId,
        upstreamId,
        directory,
        defaultModel,
        elapsedMs: Date.now() - promptStart,
      });

      // Translate the user's input into opencode `parts`. We support text
      // and base64 inline images via the FilePartInput escape hatch.
      const parts = input.parts.map((p) => {
        if (p.type === 'text') {
          return { type: 'text', text: p.text };
        }
        // image — opencode's FilePartInput wants a URL; we inline as
        // a data URL since the kernel may have already pre-uploaded.
        return {
          type: 'file',
          mime: p.mediaType,
          url: p.data.startsWith('data:') ? p.data : `data:${p.mediaType};base64,${p.data}`,
        };
      });

      const modelOverride = splitModelId(input.model ?? defaultModel);
      // eslint-disable-next-line no-console
      console.log('[agents/opencode] model resolved for opencode.session.prompt', {
        providerSessionId: input.providerSessionId,
        upstreamId,
        inputModel: input.model,
        defaultModel,
        modelOverride,
      });

      const denyList = [...factoryDefaultDenied, ...(input.extraDenied ?? [])];
      const tools = buildToolsMap({
        enabledTools: input.enabledTools,
        extraDenied: denyList,
      });

      // Honour an immediate cancel.
      if (input.abortSignal.aborted) {
        yield { type: 'session-end', reason: 'stopped' };
        return;
      }

      // Wire abortSignal → opencode session.abort. Best-effort; the
      // session-abort RPC may itself be canceled by the same DO request
      // lifetime that prompted the cancel.
      const onAbort = () => {
        void client.session
          .abort({
            sessionID: upstreamId,
            ...(directory ? { directory } : {}),
          })
          .catch(() => {
            /* swallow — abort is best-effort */
          });
      };
      input.abortSignal.addEventListener('abort', onAbort, { once: true });

      // **Why promptAsync + polling, not prompt or SSE**:
      //
      // Cloudflare Sandbox's `containerFetch` has a request-lifetime
      // budget (~10-15s) that's incompatible with the two natural
      // streaming options:
      //   - `event.subscribe` opens a long-lived SSE GET; the response
      //     body gets canceled before any events flow through.
      //   - `prompt` returns the assistant message in its HTTP response
      //     body, but the LLM call inside opencode can take 5-60s; the
      //     POST is canceled before opencode finishes, cascading to a
      //     cancel on opencode's outbound OpenRouter call too.
      //
      // `promptAsync` posts to `/session/{sessionID}/prompt_async`,
      // which acks immediately. opencode runs the turn in the
      // background. We then poll `session.messages` every
      // POLL_INTERVAL_MS — each poll is a quick request that fits in
      // `containerFetch`'s budget. Each polled snapshot includes the
      // full accumulated text for each `TextPart` and the latest
      // `ToolPart.state`, so we synthesise streaming deltas by diffing
      // against the previous snapshot.
      //
      // Termination: `AssistantMessage.time.completed` flips when the
      // turn finishes. We also cap total polling at MAX_POLL_DURATION_MS
      // so a stuck container can't leave us spinning forever.
      const POLL_INTERVAL_MS = 1500;
      const MAX_POLL_DURATION_MS = 5 * 60 * 1000;
      const POLL_BACKOFF_AFTER_S = 30;

      // eslint-disable-next-line no-console
      console.log('[agents/opencode] firing client.session.promptAsync…', {
        providerSessionId: input.providerSessionId,
        upstreamId,
        modelOverride,
        partsCount: parts.length,
        toolsCount: tools ? Object.keys(tools).length : 0,
        elapsedMs: Date.now() - promptStart,
      });
      try {
        await client.session.promptAsync({
          sessionID: upstreamId,
          parts,
          ...(modelOverride ? { model: modelOverride } : {}),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(tools ? { tools } : {}),
          ...(directory ? { directory } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[agents/opencode] promptAsync threw', {
          providerSessionId: input.providerSessionId,
          upstreamId,
          elapsedMs: Date.now() - promptStart,
          message,
        });
        input.abortSignal.removeEventListener('abort', onAbort);
        yield { type: 'session-end', reason: 'error', error: message };
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[agents/opencode] promptAsync acked', {
        providerSessionId: input.providerSessionId,
        upstreamId,
        elapsedMs: Date.now() - promptStart,
      });

      // Track which message-id we've claimed as "our" assistant message
      // for this turn, plus per-part progress so we can synthesise
      // deltas against the prior snapshot.
      let currentMessageId: string | null = null;
      const textPartLength = new Map<string, number>();
      const yieldedToolCalls = new Set<string>();
      const yieldedToolResults = new Set<string>();
      let denied: string | null = null;
      let pollCount = 0;
      const pollLoopStart = Date.now();

      try {
        while (Date.now() - pollLoopStart < MAX_POLL_DURATION_MS) {
          if (input.abortSignal.aborted) {
            // eslint-disable-next-line no-console
            console.log('[agents/opencode] abort signal aborted — exiting poll loop', {
              providerSessionId: input.providerSessionId,
              upstreamId,
              pollCount,
              elapsedMs: Date.now() - promptStart,
            });
            yield { type: 'session-end', reason: 'stopped' };
            return;
          }

          const elapsedSec = Math.floor((Date.now() - pollLoopStart) / 1000);
          const interval =
            elapsedSec < POLL_BACKOFF_AFTER_S ? POLL_INTERVAL_MS : POLL_INTERVAL_MS * 2;
          await new Promise<void>((resolve) => setTimeout(resolve, interval));
          pollCount += 1;

          let messagesResp: unknown;
          try {
            messagesResp = await client.session.messages({
              sessionID: upstreamId,
              ...(directory ? { directory } : {}),
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[agents/opencode] session.messages poll threw — retrying', {
              providerSessionId: input.providerSessionId,
              upstreamId,
              pollCount,
              message: err instanceof Error ? err.message : String(err),
            });
            continue;
          }

          const raw = (messagesResp as { data?: unknown }).data ?? messagesResp;
          const list = Array.isArray(raw) ? (raw as Array<unknown>) : [];

          // Find the newest assistant message (highest `time.created`).
          // For the first poll where currentMessageId is null we pick
          // the one whose `time.created` is >= pollLoopStart — i.e.
          // generated after we fired promptAsync. After that we stick
          // to the same messageId for the whole turn unless opencode
          // auto-continues with a new one (we'd pick that one up too).
          let target: {
            info: {
              id: string;
              role: string;
              time?: { created?: number; completed?: number };
              error?: { message?: string } | string | null;
            };
            parts: Array<unknown>;
          } | null = null;
          for (const entry of list) {
            const e = entry as {
              info?: {
                id?: string;
                role?: string;
                time?: { created?: number; completed?: number };
                error?: { message?: string } | string | null;
              };
              parts?: Array<unknown>;
            };
            if (!e.info?.id || e.info.role !== 'assistant') {
              continue;
            }
            if (currentMessageId && e.info.id !== currentMessageId) {
              continue;
            }
            const created = e.info.time?.created ?? 0;
            // Filter out assistant messages from prior turns. opencode
            // timestamps are ms-since-epoch; pollLoopStart is `Date.now()`.
            if (!currentMessageId && created < pollLoopStart - 5000) {
              continue;
            }
            target = {
              info: {
                id: e.info.id,
                role: e.info.role,
                time: e.info.time,
                error: e.info.error ?? null,
              },
              parts: e.parts ?? [],
            };
          }

          if (!target) {
            if (pollCount === 1 || pollCount % 5 === 0) {
              // eslint-disable-next-line no-console
              console.log('[agents/opencode] poll: no assistant message yet', {
                providerSessionId: input.providerSessionId,
                upstreamId,
                pollCount,
                messageCount: list.length,
              });
            }
            continue;
          }

          if (!currentMessageId) {
            currentMessageId = target.info.id;
            // eslint-disable-next-line no-console
            console.log('[agents/opencode] poll: claimed assistant message', {
              providerSessionId: input.providerSessionId,
              upstreamId,
              messageId: currentMessageId,
              pollCount,
              elapsedMs: Date.now() - promptStart,
            });
          }

          // Diff each part against the previous snapshot and yield
          // events for the delta.
          for (const rawPart of target.parts) {
            const part = rawPart as {
              type?: string;
              id?: string;
              callID?: string;
              tool?: string;
              text?: string;
              input?: unknown;
              state?: { status?: string; output?: unknown; error?: string };
            };
            if (!part.type) {
              continue;
            }
            switch (part.type) {
              case 'text': {
                if (typeof part.text !== 'string' || !part.id) {
                  break;
                }
                const prev = textPartLength.get(part.id) ?? 0;
                if (part.text.length > prev) {
                  const newText = part.text.slice(prev);
                  textPartLength.set(part.id, part.text.length);
                  yield {
                    type: 'text-delta',
                    messageId: currentMessageId,
                    text: newText,
                  };
                }
                break;
              }
              case 'tool': {
                const callId = part.callID ?? part.id;
                if (!callId) {
                  break;
                }
                const toolName = part.tool ?? '<unknown>';
                if (denyList.length > 0 && denyList.includes(toolName)) {
                  if (!yieldedToolResults.has(callId)) {
                    onAbort();
                    yield {
                      type: 'tool-result',
                      messageId: currentMessageId,
                      id: callId,
                      output: `Tool "${toolName}" is denied for this session`,
                      isError: true,
                    };
                    yieldedToolResults.add(callId);
                    denied = toolName;
                  }
                  break;
                }
                if (!yieldedToolCalls.has(callId)) {
                  yield {
                    type: 'tool-call',
                    messageId: currentMessageId,
                    id: callId,
                    name: toolName,
                    input: part.input,
                  };
                  yieldedToolCalls.add(callId);
                }
                const status = part.state?.status;
                if (
                  !yieldedToolResults.has(callId) &&
                  (status === 'completed' || status === 'error')
                ) {
                  yield {
                    type: 'tool-result',
                    messageId: currentMessageId,
                    id: callId,
                    output: part.state?.output ?? part.state?.error ?? null,
                    isError: status === 'error',
                  };
                  yieldedToolResults.add(callId);
                }
                break;
              }
              default: {
                // Reasoning / step-start / step-finish / snapshot etc.
                // are intentionally ignored — they're internal opencode
                // bookkeeping that the chat UI doesn't render. Log the
                // first occurrence of each unknown type for future
                // mapping work.
                if (pollCount === 1) {
                  // eslint-disable-next-line no-console
                  console.log('[agents/opencode] poll: unmapped part type', {
                    providerSessionId: input.providerSessionId,
                    upstreamId,
                    partType: part.type,
                  });
                }
                break;
              }
            }
            if (denied) {
              break;
            }
          }

          // Terminal check: AssistantMessage.time.completed flips when
          // the turn is fully done (including all tool calls + any
          // auto-continuation). info.error is set on provider failures.
          const completed = Boolean(target.info.time?.completed);
          const errorEnvelope = target.info.error;
          const hasError =
            errorEnvelope !== null && errorEnvelope !== undefined && errorEnvelope !== '';
          if (denied || completed || hasError) {
            yield { type: 'message-complete', messageId: currentMessageId };
            let reason: 'stopped' | 'error' | 'completed';
            let errorText: string | undefined;
            if (denied) {
              reason = 'stopped';
              errorText = `denied tool "${denied}"`;
            } else if (hasError) {
              reason = 'error';
              errorText =
                typeof errorEnvelope === 'string'
                  ? errorEnvelope
                  : ((errorEnvelope as { message?: string }).message ??
                    JSON.stringify(errorEnvelope));
            } else {
              reason = 'completed';
            }
            yield {
              type: 'session-end',
              reason,
              ...(errorText ? { error: errorText } : {}),
            };
            // eslint-disable-next-line no-console
            console.log('[agents/opencode] poll: turn finished', {
              providerSessionId: input.providerSessionId,
              upstreamId,
              messageId: currentMessageId,
              pollCount,
              reason,
              elapsedMs: Date.now() - promptStart,
            });
            return;
          }
        }
      } finally {
        input.abortSignal.removeEventListener('abort', onAbort);
      }

      // Hit the polling cap without seeing completion. The container
      // is probably stuck or the LLM hung. Abort upstream so opencode
      // releases resources, then surface the timeout.
      // eslint-disable-next-line no-console
      console.warn('[agents/opencode] poll: hit MAX_POLL_DURATION_MS without completion', {
        providerSessionId: input.providerSessionId,
        upstreamId,
        pollCount,
        elapsedMs: Date.now() - promptStart,
      });
      onAbort();
      if (currentMessageId) {
        yield { type: 'message-complete', messageId: currentMessageId };
      }
      yield {
        type: 'session-end',
        reason: 'error',
        error: `Turn exceeded ${Math.floor(MAX_POLL_DURATION_MS / 1000)}s without completion`,
      };

      // Stale references to the now-unused SSE iteration helpers.
      // Kept imported so tests that introspect the module namespace
      // don't break, but acknowledged here to silence unused warnings.
      void createMapperState;
      void mapOpencodeEvent;
      void isForThisSession;
    },

    async listMessages(input: ListMessagesInput): Promise<AgentProviderMessage[]> {
      const session = sessionsById.get(input.providerSessionId);
      if (!session) {
        return [];
      }
      // The upstream session may not have been provisioned yet (the user
      // created the chat but hasn't sent a prompt). Return [] in that
      // case — there can't be any messages to list.
      if (!session.upstreamSessionId) {
        return [];
      }
      const client = await resolveSessionClient(session);
      const resp = (await client.session.messages({
        sessionID: session.upstreamSessionId,
        ...(session.directory ? { directory: session.directory } : {}),
      })) as unknown as { data?: Array<unknown> } | Array<unknown>;

      const arr = Array.isArray(resp) ? resp : (resp?.data ?? []);
      const messages: AgentProviderMessage[] = [];
      for (const item of arr) {
        const m = item as {
          info?: {
            id: string;
            role: 'user' | 'assistant';
            time?: { created: number };
          };
          parts?: Array<{ type: string; text?: string }>;
        };
        if (!m.info) {
          continue;
        }
        const parts = (m.parts ?? []).map((p) =>
          p.type === 'text' && typeof p.text === 'string'
            ? { type: 'text' as const, text: p.text }
            : ({ ...p } as Record<string, unknown>),
        );
        messages.push({
          id: m.info.id,
          role: m.info.role,
          parts,
          createdAt: m.info.time?.created
            ? new Date(m.info.time.created).toISOString()
            : new Date().toISOString(),
        });
      }
      // Apply pagination naively — opencode returns the full list; if
      // we ever need true cursor-based paging the SDK exposes it via
      // query params and we extend here.
      const limit = input.limit ?? messages.length;
      return messages.slice(0, limit);
    },

    async listModels(): Promise<AgentModel[]> {
      // Listing models requires picking a baseUrl. We don't have one at
      // the registry level (no workspace yet). Return [] so the UI falls
      // back to the static default; the per-session config picker uses
      // session-level data. A future enhancement can accept a baseUrl
      // hint via plugin options.
      return [];
    },

    async closeSession(providerSessionId: string): Promise<void> {
      const session = sessionsById.get(providerSessionId);
      if (!session) {
        return;
      }
      sessionsById.delete(providerSessionId);
      // Nothing to delete upstream if we never provisioned it.
      if (!session.upstreamSessionId) {
        return;
      }
      try {
        const client = await resolveSessionClient(session);
        await client.session.delete({
          sessionID: session.upstreamSessionId,
          ...(session.directory ? { directory: session.directory } : {}),
        });
      } catch {
        // Best-effort cleanup; sandbox teardown will reclaim everything.
      }
    },

    async shutdown(): Promise<void> {
      sessionsById.clear();
      clearClientCache();
      clearEmbeddedCache();
    },
  };
}

/**
 * Resolve the right `OpencodeClientLike` for a stored session. External
 * sessions reuse the per-baseUrl HTTP-client cache; embedded sessions reuse
 * the per-directory in-process server cache.
 */
async function resolveSessionClient(session: {
  mode: OpencodeMode;
  baseUrl?: string;
  directory?: string;
  workspace?: WorkspaceHandle;
}): Promise<OpencodeClientLike> {
  if (session.mode === 'sandbox') {
    const meta = session.workspace?.metadata as
      | {
          getOpencode?: (opts?: { directory?: string }) => Promise<{ client: OpencodeClientLike }>;
        }
      | undefined;
    if (!meta?.getOpencode) {
      throw new Error(
        '[agents/opencode] sandbox session lost its workspace handle — was the provider restarted?',
      );
    }
    const bundle = await meta.getOpencode(
      session.directory ? { directory: session.directory } : undefined,
    );
    return bundle.client;
  }
  if (session.mode === 'embedded') {
    const handle = await getEmbedded(session.directory ?? '');
    return handle.client;
  }
  if (!session.baseUrl) {
    throw new Error('[agents/opencode] external session has no baseUrl — was createSession run?');
  }
  return getClient(session.baseUrl, session.directory);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Detect whether the workspace's `cloudflareSandbox` was configured
 * with `outboundAuth`. When true, the opencode provider boots
 * OpenCode with placeholder API keys + a session-id header, and the
 * consumer Worker's `Sandbox.outboundByHost` handler injects the real
 * key at egress.
 */
function hasOutboundAuth(workspace: WorkspaceHandle | undefined): boolean {
  const meta = workspace?.metadata as { outboundAuth?: unknown } | undefined;
  return Boolean(
    meta?.outboundAuth &&
    typeof (meta.outboundAuth as { bindCredential?: unknown }).bindCredential === 'function',
  );
}

/**
 * Vendors we boot OpenCode with placeholders for under outbound mode.
 * Mirrors `buildFlowlibOutboundHandlers()`'s host map — the consumer
 * Worker's outbound handlers must cover every vendor listed here.
 *
 * Cloudflare AI Gateway uses a different config shape (no bare
 * `apiKey`), so it isn't pre-populated here; users wanting it in
 * outbound mode declare it explicitly in their factory config.
 */
const OUTBOUND_VENDORS: ReadonlyArray<OutboundVendor> = [
  'anthropic',
  'openai',
  'openrouter',
  'google',
];

const OUTBOUND_PLACEHOLDER_KEY = 'flowlib-outbound-placeholder';

/**
 * Build the OpenCode `Config.provider` map used in outbound mode.
 * Every supported vendor gets a placeholder `apiKey` + a
 * `X-Flowlib-Session-Id` header so the request, when it leaves the
 * container, is identifiable to the outbound handler. The handler
 * looks up the real key in KV by session id and replaces the
 * vendor-specific auth header before forwarding upstream.
 */
/**
 * Per-vendor canonical base URLs that match the host map the consumer
 * Worker installs on `Sandbox.outboundByHost`. We pin these on every
 * vendor's `options.baseURL` so opencode's HTTP requests definitely
 * route through a host the outbound handler recognises — without the
 * pin, opencode picks its own default (which may not match e.g.
 * `api.anthropic.com` exactly).
 *
 * Pattern lifted from
 * https://github.com/cloudflare/sandbox-sdk/tree/main/examples/opencode
 * which explicitly sets `baseURL: 'https://api.anthropic.com/v1'` on
 * the placeholder anthropic provider config.
 */
const OUTBOUND_VENDOR_BASE_URLS: Record<OutboundVendor, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  'cloudflare-ai-gateway': 'https://gateway.ai.cloudflare.com/v1',
};

function buildOutboundProviderConfig(sessionId: string): Record<string, unknown> {
  const provider: Record<string, unknown> = {};
  for (const vendor of OUTBOUND_VENDORS) {
    provider[vendor] = {
      options: {
        apiKey: OUTBOUND_PLACEHOLDER_KEY,
        baseURL: OUTBOUND_VENDOR_BASE_URLS[vendor],
        headers: { [FLOWLIB_SESSION_HEADER]: sessionId },
      },
    };
  }
  return provider;
}

function isForThisSession(evt: OpencodeEvent, sessionId: string): boolean {
  const props = (evt as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') {
    return true;
  }
  const p = props as {
    sessionID?: string;
    info?: { sessionID?: string };
    part?: { sessionID?: string };
  };
  if (typeof p.sessionID === 'string') {
    return p.sessionID === sessionId;
  }
  if (p.info && typeof p.info.sessionID === 'string') {
    return p.info.sessionID === sessionId;
  }
  if (p.part && typeof p.part.sessionID === 'string') {
    return p.part.sessionID === sessionId;
  }
  // Global events (e.g. `file.edited`) have no sessionID — let them
  // through so workspace-level signals reach the consumer.
  return true;
}

/** Test helper — drop the session map. @internal */
export function _resetSessionsForTests(): void {
  sessionsById.clear();
}
