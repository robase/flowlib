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
    return (
      c?.randomUUID?.() ?? `oc-pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
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
    const session = sessionsById.get(placeholderId);
    if (!session) {
      throw new Error(`[agents/opencode] unknown session id ${placeholderId}`);
    }
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
        const outboundMode =
          session.mode === 'sandbox' && hasOutboundAuth(session.workspace);
        if (outboundMode) {
          providerCfg = buildOutboundProviderConfig(placeholderId);
        } else if (session.mode === 'sandbox' && loadProviderConfig && session.auth) {
          try {
            const loaded = await loadProviderConfig({
              auth: session.auth,
              credentialId: session.credentialId,
            });
            providerCfg = loaded ?? undefined;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`[agents/opencode] loadProviderConfig failed: ${message}`);
          }
        }
        const { client, baseUrl } = await getClientForMode({
          mode: session.mode,
          workspace: session.workspace,
          extras: { ...session.extras },
          factoryBaseUrl,
          opencodeOverride: providerCfg ? { config: { provider: providerCfg } } : undefined,
        });
        let resp: unknown;
        try {
          resp = await client.session.create({
            body: { title: session.title },
            ...(session.directory ? { query: { directory: session.directory } } : {}),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            `[agents/opencode] session.create failed (mode=${session.mode}, target=${baseUrl ?? '<unknown>'}): ${message}`,
          );
        }
        const upstreamId = unwrapSessionId(resp);
        session.upstreamSessionId = upstreamId;
        session.baseUrl = baseUrl;
        return upstreamId;
      })().catch((err) => {
        // Allow retry on the next call if boot fails.
        session.upstreamSessionPromise = undefined;
        throw err;
      });
    }
    const upstreamId = session.upstreamSessionId ?? (await session.upstreamSessionPromise!);
    const client = await resolveSessionClient(session);
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
      const placeholderId = newPlaceholderSessionId();
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
      if (!sessionsById.has(input.providerSessionId)) {
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
        yield {
          type: 'session-end',
          reason: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
        return;
      }
      const { session, upstreamId, client } = upstreamHandle;
      const { directory, defaultModel, systemPrompt } = session;

      // Open the SSE event stream first so we don't miss the assistant's
      // first part. Filter by sessionID inside the loop.
      const streamPromise = client.event.subscribe(
        directory ? { query: { directory } } : undefined,
      );

      const stream = await streamPromise;

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

      // Wire abortSignal → opencode session.abort. The SSE iterator
      // bails out below as soon as `aborted` flips, so this is purely
      // for the server-side state.
      const onAbort = () => {
        void client.session
          .abort({
            path: { id: upstreamId },
            ...(directory ? { query: { directory } } : {}),
          })
          .catch(() => {
            /* swallow — abort is best-effort */
          });
      };
      input.abortSignal.addEventListener('abort', onAbort, { once: true });

      // Fire the prompt. We do NOT await its resolution before draining
      // the event stream — opencode publishes deltas through the event
      // channel, and the prompt promise only resolves at the end of the
      // turn (after the message-complete event has already gone out).
      const promptPromise = client.session.prompt({
        path: { id: upstreamId },
        body: {
          parts,
          ...(modelOverride ? { model: modelOverride } : {}),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(tools ? { tools } : {}),
        },
        ...(directory ? { query: { directory } } : {}),
      });

      // Swallow rejections — they re-surface as `session.error` events
      // through the SSE channel.
      promptPromise.catch(() => {
        /* surfaced via session.error */
      });

      const mapperState = createMapperState();
      let terminated = false;

      try {
        for await (const raw of stream.stream as AsyncIterable<unknown>) {
          if (input.abortSignal.aborted) {
            break;
          }

          const evt = raw as OpencodeEvent;
          if (!isForThisSession(evt, upstreamId)) {
            continue;
          }

          // Best-effort tool-deny enforcement: if a `tool-call` is
          // about to fire for a denied tool, abort the session BEFORE
          // forwarding the event. The sandbox prevents persistent damage;
          // this stops unnecessary token spend.
          const mapped = mapOpencodeEvent(evt, mapperState);
          for (const out of mapped) {
            if (out.type === 'tool-call' && denyList.length > 0 && denyList.includes(out.name)) {
              onAbort();
              yield {
                type: 'tool-result',
                messageId: out.messageId,
                id: out.id,
                output: `Tool "${out.name}" is denied for this session`,
                isError: true,
              };
              yield {
                type: 'session-end',
                reason: 'stopped',
                error: `denied tool "${out.name}"`,
              };
              terminated = true;
              break;
            }
            yield out;
            if (out.type === 'session-end') {
              terminated = true;
              break;
            }
          }
          if (terminated) {
            break;
          }
        }
      } finally {
        input.abortSignal.removeEventListener('abort', onAbort);
      }

      if (input.abortSignal.aborted && !terminated) {
        yield { type: 'session-end', reason: 'stopped' };
      }
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
        path: { id: session.upstreamSessionId },
        ...(session.directory ? { query: { directory: session.directory } } : {}),
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
          path: { id: session.upstreamSessionId },
          ...(session.directory ? { query: { directory: session.directory } } : {}),
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
function buildOutboundProviderConfig(sessionId: string): Record<string, unknown> {
  const provider: Record<string, unknown> = {};
  for (const vendor of OUTBOUND_VENDORS) {
    provider[vendor] = {
      options: {
        apiKey: OUTBOUND_PLACEHOLDER_KEY,
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
