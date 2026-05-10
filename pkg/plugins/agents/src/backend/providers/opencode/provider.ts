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
 *   - `'external'` (default): `createOpencodeClient({ baseUrl })` against
 *     a long-running `opencode serve`. The baseUrl resolves from (in
 *     priority order) `workspace.metadata.opencodeBaseUrl` (set by
 *     `cloudflareSandbox`), `extras.baseUrl`, factory `baseUrl`, or
 *     `$OPENCODE_BASE_URL`. Used in production with the CF Sandbox.
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
  /** Resolved baseUrl (external) or embedded server URL. May be undefined if the embedded handle pre-dates URL exposure. */
  baseUrl?: string;
  directory?: string;
  defaultModel?: string;
  systemPrompt?: string;
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
   * Connection mode:
   *
   *   - `'external'` (default): use `createOpencodeClient({ baseUrl })` —
   *     the v1 production posture: opencode runs inside a `cloudflareSandbox`
   *     workspace and the provider talks to it over HTTP.
   *   - `'embedded'`: use `createOpencode()` — starts an in-process server
   *     and multiplexes sessions over it. Cached per workspace `directory`.
   *     Use this for local dev or single-tenant non-CF deployments.
   */
  mode?: OpencodeMode;
  /**
   * Optional fixed baseUrl for external mode — used when ops runs an
   * `opencode serve` instance independent of any workspace and you want
   * the provider to default to it. Lower priority than
   * `workspace.metadata.opencodeBaseUrl` and `extras.baseUrl`.
   */
  baseUrl?: string;
  /**
   * Default tool deny list applied to every session — useful for posture
   * defaults. Merges with per-agent `defaultDenied` and per-prompt
   * `extraDenied`.
   */
  defaultDenied?: ReadonlyArray<string>;
}

export function openCodeProvider(options: OpenCodeProviderOptions = {}): AgentProvider {
  const factoryDefaultModel = options.defaultModel;
  const factoryMode: OpencodeMode = options.mode ?? 'external';
  const factoryBaseUrl = options.baseUrl;
  const factoryDefaultDenied = options.defaultDenied ?? [];

  return {
    id: 'opencode',
    name: 'opencode',
    icon: 'Code2',
    capabilities: OPENCODE_CAPABILITIES,

    validateConfig: validateOpenCodeConfig,

    async createSession(input: CreateSessionInput): Promise<{ providerSessionId: string }> {
      const cfg = (input.config ?? {}) as OpenCodeConfig;
      const directory = input.workspace?.rootPath;

      // Mode resolution: per-session config beats factory option.
      const mode: OpencodeMode =
        (typeof input.extras?.mode === 'string'
          ? (input.extras.mode as OpencodeMode)
          : undefined) ??
        cfg.mode ??
        factoryMode;

      // External mode needs `workspace.metadata.opencodeBaseUrl` set
      // before `getClientForMode` runs. The cloudflareSandbox handle
      // exposes a lazy `startOpencode()` that boots `opencode serve`
      // inside the sandbox and caches the resulting URL on
      // `metadata.opencodeBaseUrl`. Call it first so the resolver can
      // pick the URL up — unless an explicit baseUrl was supplied (then
      // the caller is pinning their own opencode instance).
      if (mode === 'external' && input.workspace?.metadata) {
        const meta = input.workspace.metadata as {
          opencodeBaseUrl?: string | null;
          startOpencode?: () => Promise<string>;
        };
        const explicitBaseUrl =
          (typeof input.extras?.baseUrl === 'string' && input.extras.baseUrl) ||
          (typeof cfg.baseUrl === 'string' && cfg.baseUrl) ||
          factoryBaseUrl;
        if (!meta.opencodeBaseUrl && !explicitBaseUrl && typeof meta.startOpencode === 'function') {
          const url = await meta.startOpencode();
          if (url && url !== 'opencode-not-configured') {
            meta.opencodeBaseUrl = url;
          }
        }
      }

      const { client, baseUrl } = await getClientForMode({
        mode,
        workspace: input.workspace,
        extras: { baseUrl: cfg.baseUrl, ...input.extras },
        factoryBaseUrl,
      });

      const titleExtra = input.extras?.title;
      const title = typeof titleExtra === 'string' ? titleExtra : `flowlib-${Date.now()}`;

      // `exposePort` returns as soon as the port is published, but
      // `opencode serve` inside the sandbox may take a few seconds to
      // start accepting requests. Retry the session.create with linear
      // backoff so we don't 500 just because of a boot race.
      const maxAttempts = 8;
      const backoffMs = 500;
      let resp: unknown;
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          resp = await client.session.create({
            body: { title },
            ...(directory ? { query: { directory } } : {}),
          });
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }
      if (lastErr) {
        const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
        throw new Error(
          `[agents/opencode] session.create failed against ${baseUrl ?? '<unknown>'} after ${maxAttempts} attempts: ${message}. ` +
            'Check that the opencode server is reachable from this Worker — the cloudflareSandbox preview URL may not resolve in local dev unless you have wildcard DNS / CF tunnel set up; ' +
            'in that case configure `agents({ providers: [openCodeProvider({ baseUrl: "http://…" })] })` to point at a directly-reachable opencode instance, or set `OPENCODE_BASE_URL`.',
        );
      }
      const id = unwrapSessionId(resp);

      sessionsById.set(id, {
        mode,
        baseUrl,
        directory,
        defaultModel: cfg.defaultModel ?? factoryDefaultModel,
        systemPrompt: cfg.systemPrompt ?? input.systemPrompt,
      });

      return { providerSessionId: id };
    },

    async *prompt(input: PromptInput): AsyncIterable<AgentEvent> {
      const session = sessionsById.get(input.providerSessionId);
      if (!session) {
        yield {
          type: 'session-end',
          reason: 'error',
          error: `[agents/opencode] unknown session id ${input.providerSessionId} — call createSession first`,
        };
        return;
      }

      const { mode, baseUrl, directory, defaultModel, systemPrompt } = session;
      const client = await resolveSessionClient({ mode, baseUrl, directory });

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
            path: { id: input.providerSessionId },
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
        path: { id: input.providerSessionId },
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
          if (!isForThisSession(evt, input.providerSessionId)) {
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
      const client = await resolveSessionClient(session);
      const resp = (await client.session.messages({
        path: { id: input.providerSessionId },
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
      try {
        const client = await resolveSessionClient(session);
        await client.session.delete({
          path: { id: providerSessionId },
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
}): Promise<OpencodeClientLike> {
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
