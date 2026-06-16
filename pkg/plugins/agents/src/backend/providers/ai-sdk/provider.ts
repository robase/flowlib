/**
 * `aiSdkProvider` — the new agent provider that runs the turn loop
 * natively in the Durable Object using Vercel's `ai` package's
 * `streamText`, with tools dispatched out to flowlib actions /
 * sandbox calls.
 *
 * Architectural intent (see
 * `pkg/plugins/agents/docs/migration-plan-ai-sdk.md`):
 *
 *   ┌────────────────────┐    streamText (SSE, real streaming)
 *   │   AgentChatDO       │ ───────────────────────────────────▶  LLM
 *   │  (this provider     │ ◀───────────────────────────────────  (Anthropic / OpenAI / OpenRouter / Google)
 *   │   runs the loop)    │
 *   └────────┬───────────┘
 *            │ tool call
 *            ▼
 *      flowlib action ────▶ Sandbox (short containerFetch, no streaming)
 *                        │
 *                        ▶ External APIs (Gmail, GitHub, etc.)
 *
 * Key property: long-lived streaming (LLM SSE) goes DO ↔ provider
 * directly, never through `containerFetch`. Each tool call IS a
 * short request — fits inside `containerFetch`'s budget.
 *
 * SDK imports are lazy so apps that only use other providers don't
 * pay the bundle weight.
 */

import type { AgentEvent } from '../../../shared/events';
import type {
  AgentCapabilities,
  AgentCredentialsAccessor,
  AgentProvider,
  AgentProviderConfig,
  CreateSessionInput,
  ListMessagesInput,
  AgentProviderMessage,
  PromptInput,
} from '../types';
import type { WorkspaceHandle, WorkspaceAccessor } from '../../workspaces/types';
import type { AiSdkCredential, AiSdkProviderOptions } from './types';
import { randomBytes } from 'node:crypto';
import { parseModelSpec, resolveModel } from './models';
import { resolveCredentialFromAccessor } from './host-helpers';
import {
  assembleToolSet,
  buildToolSet,
  wrapToolsWithOutputStore,
  type AiSdkToolSet,
} from './tools';
import { createToolOutputStore } from '../../tools/tool-output-store';

/**
 * Per-session in-memory state. The provider keeps these keyed by the
 * placeholder session id we returned from `createSession`. Mirrors
 * the shape opencode provider uses so the orchestrator's lifecycle
 * code is identical for both.
 */
interface SessionState {
  /** Resolved auth context — used for credential lookups on re-resolve. */
  auth: CreateSessionInput['auth'];
  /** Credential id supplied at session-create time. */
  credentialId?: string;
  /** Default model id for this session. */
  defaultModel: string;
  /** Composed system prompt (may be empty). */
  systemPrompt?: string;
  /**
   * Workspace handle bound to this session, once one has been
   * provisioned. Populated either eagerly at `createSession` (rare for
   * this provider) or lazily the first time `ensureWorkspace` runs.
   * Sessions that never touch a `sandbox.*` tool (pure-chat) leave this
   * undefined and never boot a container.
   */
  workspace?: WorkspaceHandle;
  /**
   * Host-supplied lazy provisioner. Called the first time a tool needs
   * the sandbox; creates the workspace row if missing, resolves the
   * handle, persists the workspace id onto the session, and returns the
   * handle. The provider caches the result in {@link SessionState.workspace}.
   */
  ensureWorkspace?: WorkspaceAccessor;
  /**
   * Last resolved credential — cached for the lifetime of this
   * isolate. The orchestrator may call `prompt()` many times against
   * the same session; we resolve once and reuse.
   */
  credential?: AiSdkCredential;
  /**
   * Credentials accessor threaded in by the host (the agents plugin sets
   * it from `flowlib.credentials`). Used by the built-in default resolver
   * when no `resolveCredential` option is wired.
   */
  credentials?: AgentCredentialsAccessor;
  /** Whether `createSession` extras opted into specific features. */
  extras?: Record<string, unknown>;
}

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  // We don't natively wire MCP servers in Phase 1 — flowlib actions
  // act as the tool catalogue. MCP wiring lands in a later phase if
  // we want to expose external MCP servers to the agent.
  mcpServers: false,
  parallelToolCalls: true,
  // We can edit files via sandbox-backed tools but the provider
  // itself doesn't touch the workspace. Filesystem capability is
  // gated by which tools the host enables.
  fileEdits: true,
  // Streams resume via AIChatAgent's WS buffer, same as opencode.
  resumableStream: false,
  // The loop runs in the DO, not a container, so we DON'T need a sandbox
  // up front. Setting this false stops the session-create endpoint from
  // eager-provisioning a container per chat. The sandbox is instead
  // booted on demand by the `sandbox.*` tools (explicitly via
  // `sandbox.start`, or implicitly on first file/shell use) through the
  // host-supplied `ensureWorkspace` accessor. Pure-chat turns — including
  // ones that only call remote HTTP tools — never pay the cold-start.
  workspaceRequired: false,
  permissionPrompts: true,
  preferredWorkspaceProviderId: 'cloudflare-sandbox',
};

/**
 * Sanitise tool names to the `^[a-zA-Z0-9_-]{1,128}$` pattern that strict
 * providers enforce (Google/Gemini, and some OpenRouter routes reject the
 * dot). Our action-backed tools are dotted — `sandbox.start`,
 * `github.create_issue`, `flowlib.list_flows` — which the LLM API rejects
 * with `tools.N.custom.name: String should match pattern …`.
 *
 * We rewrite `.` (and any other invalid char) to `_` for the wire, and
 * return a reverse map so the emitted `tool-call` events carry the
 * original dotted id (the frontend + tool renderers key off it). The AI
 * SDK calls the executor by the sanitised key it sent, so execution is
 * unaffected.
 */
function sanitiseToolSet(tools: AiSdkToolSet): {
  tools: AiSdkToolSet;
  restore: Map<string, string>;
} {
  const out: AiSdkToolSet = {};
  const restore = new Map<string, string>();
  const used = new Set<string>();
  for (const [name, tool] of Object.entries(tools)) {
    let safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    if (safe.length === 0) {
      safe = '_';
    }
    // Deterministically dedupe the rare case where two names sanitise to
    // the same string.
    let candidate = safe;
    let n = 1;
    while (used.has(candidate)) {
      candidate = `${safe}_${n++}`.slice(0, 128);
    }
    used.add(candidate);
    out[candidate] = tool;
    if (candidate !== name) {
      restore.set(candidate, name);
    }
  }
  return { tools: out, restore };
}

/**
 * Construct the provider singleton. Called once at plugin init by
 * `registerProviders`. All SDK imports are lazy — none happens
 * inside this factory, only on first `prompt()` call.
 */
export function aiSdkProvider(options: AiSdkProviderOptions): AgentProvider {
  const providerId = options.id ?? 'ai-sdk';
  const providerName = options.name ?? 'AI SDK (Vercel)';
  const providerIcon = options.icon;
  const defaultModel = options.defaultModel ?? 'anthropic/claude-sonnet-4-5';
  const maxSteps = options.maxSteps ?? 25;
  const defaultDenied = options.defaultDenied ?? [];
  const resolveCredential = options.resolveCredential;
  const toolsFactory = options.tools;
  const streamText = options.streamText;
  const vendors = options.vendors;

  // One store per provider isolate. Caps each tool result to the inline
  // budget (default 100 lines / 4 KB) and spills the overflow to the
  // session workspace so the model can read it back on demand. Without
  // this, a single large tool output floods the context window.
  const toolOutputStore = createToolOutputStore({
    ...(options.toolOutputBudget ? { budget: options.toolOutputBudget } : {}),
    logger: {
      warn: (message: string, ...args: unknown[]) => {
        // eslint-disable-next-line no-console
        console.warn(message, ...args);
      },
    },
  });

  // `resolveCredential` is optional: when omitted, the provider resolves
  // the session's attached credential via the host-threaded credentials
  // accessor (`CreateSessionInput.credentials`, set by the agents plugin
  // from `flowlib.credentials`). Supply `resolveCredential` only for
  // custom logic (e.g. a dev env-key fallback).
  if (typeof streamText !== 'function') {
    throw new Error(
      `aiSdkProvider({ id: ${providerId} }): streamText is required. ` +
        "Statically import it in the host (`import { streamText } from 'ai'`) " +
        'and wire it into the provider options. Cloudflare Workers cannot ' +
        'dynamically import optional peer deps at runtime, so the host owns ' +
        'the static binding.',
    );
  }
  if (!vendors || Object.keys(vendors).length === 0) {
    throw new Error(
      `aiSdkProvider({ id: ${providerId} }): at least one vendor factory ` +
        'must be wired via the `vendors` option. Example: `vendors: { ' +
        'anthropic: (cred, id) => createAnthropic({ apiKey: cred.apiKey })(id) }`.',
    );
  }

  const sessionsById = new Map<string, SessionState>();

  function newPlaceholderSessionId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID?.() ?? `ai-sdk-${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  /**
   * Resolve (and cache) the credential for a session's model vendor.
   * Called lazily on first `prompt()` so an unused session never
   * fetches a credential.
   */
  async function ensureCredential(session: SessionState): Promise<AiSdkCredential> {
    if (session.credential) {
      return session.credential;
    }
    const spec = parseModelSpec(session.defaultModel);
    let credential: AiSdkCredential | null = null;
    // 1. Host-supplied resolver wins when provided — the host knows its
    //    own vendor routing (e.g. a dedicated `openrouter` vendor rather
    //    than the generic OpenAI-compatible mapping) and any env fallback.
    if (resolveCredential) {
      credential = await resolveCredential({
        auth: session.auth,
        credentialId: session.credentialId,
        vendor: spec.vendor,
      });
    }
    // 2. Built-in default: resolve the chat's attached credential via the
    //    host-threaded credentials accessor (`registries.credentials`,
    //    wired automatically by the plugin). This is the zero-config
    //    "bring-your-own-key" path for hosts that pass no resolver.
    if (!credential && session.credentials && session.credentialId) {
      credential = await resolveCredentialFromAccessor(session.credentials, {
        credentialId: session.credentialId,
        vendor: spec.vendor,
      });
    }
    if (!credential) {
      throw new Error(
        `aiSdkProvider({ id: ${providerId} }): could not resolve a credential for vendor ` +
          `"${spec.vendor}" (credentialId=${session.credentialId ?? 'none'}). Attach an LLM ` +
          'credential to the chat, or pass a `resolveCredential` option.',
      );
    }
    session.credential = credential;
    return credential;
  }

  /**
   * Build the AI SDK message history for the turn. Phase 1 keeps this
   * simple: the user's incoming `parts` become the latest user
   * message. The chat history is stored in `AIChatAgent.messages`
   * (DO storage) and flows through the AIChatAgent base class —
   * we'll wire that in once the basic loop is verified.
   */
  function buildMessages(input: PromptInput): Array<{
    role: 'user' | 'assistant' | 'system';
    content: Array<{ type: 'text'; text: string }>;
  }> {
    const userParts: Array<{ type: 'text'; text: string }> = [];
    for (const part of input.parts) {
      if (part.type === 'text') {
        userParts.push({ type: 'text', text: part.text });
      }
      // image / file parts: Phase 1 ignores; AI SDK supports
      // multi-modal but tying it through requires per-vendor handling.
    }
    return [{ role: 'user', content: userParts }];
  }

  return {
    id: providerId,
    name: providerName,
    ...(providerIcon ? { icon: providerIcon } : {}),
    defaultModel,
    capabilities: CAPABILITIES,

    validateConfig(config: unknown): AgentProviderConfig {
      // Phase 1: accept any object. We narrow this once we expose
      // provider-specific options (e.g. `temperature`, `topP`,
      // `tool-choice strategies`).
      return (config ?? {}) as AgentProviderConfig;
    },

    async createSession(input: CreateSessionInput): Promise<{ providerSessionId: string }> {
      const sessionId = input.providerSessionId ?? newPlaceholderSessionId();
      if (input.providerSessionId && sessionsById.has(input.providerSessionId)) {
        // Idempotent rehydration — but REFRESH mutable per-turn state. A
        // session is often registered earlier (e.g. credential-less at
        // chat-create time) and the chat can change its model, credential,
        // system prompt, or workspace between turns. Without this refresh the
        // first registration's stale state (default model, no credential)
        // sticks for the isolate's lifetime, so credential resolution targets
        // the wrong vendor or finds no credential at all.
        const existing = sessionsById.get(input.providerSessionId)!;
        const nextModel =
          (input.config?.defaultModel as string | undefined) ?? existing.defaultModel;
        const credentialChanged = existing.credentialId !== input.credentialId;
        const modelChanged = nextModel !== existing.defaultModel;
        existing.auth = input.auth;
        existing.credentialId = input.credentialId;
        existing.defaultModel = nextModel;
        existing.systemPrompt = input.systemPrompt;
        existing.extras = input.extras;
        if (input.credentials) {
          existing.credentials = input.credentials;
        }
        if (input.workspace) {
          existing.workspace = input.workspace;
        }
        if (input.ensureWorkspace) {
          existing.ensureWorkspace = input.ensureWorkspace;
        }
        // Drop the cached resolved credential if the credential or model
        // (hence vendor) changed, so the next `prompt()` re-resolves.
        if (credentialChanged || modelChanged) {
          existing.credential = undefined;
        }
        return { providerSessionId: input.providerSessionId };
      }
      sessionsById.set(sessionId, {
        auth: input.auth,
        credentialId: input.credentialId,
        defaultModel: (input.config?.defaultModel as string | undefined) ?? defaultModel,
        systemPrompt: input.systemPrompt,
        ...(input.credentials ? { credentials: input.credentials } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
        ...(input.ensureWorkspace ? { ensureWorkspace: input.ensureWorkspace } : {}),
        extras: input.extras,
      });
      // eslint-disable-next-line no-console
      console.log('[agents/ai-sdk] session created', {
        providerId,
        providerSessionId: sessionId,
        defaultModel: sessionsById.get(sessionId)?.defaultModel,
        hasSystemPrompt: Boolean(input.systemPrompt),
      });
      return { providerSessionId: sessionId };
    },

    async *prompt(input: PromptInput): AsyncGenerator<AgentEvent, void, void> {
      const promptStart = Date.now();
      const session = sessionsById.get(input.providerSessionId);
      if (!session) {
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] prompt: unknown session', {
          providerSessionId: input.providerSessionId,
        });
        yield {
          type: 'session-end',
          reason: 'error',
          error: `unknown session ${input.providerSessionId}`,
        };
        return;
      }
      if (input.abortSignal.aborted) {
        yield { type: 'session-end', reason: 'stopped' };
        return;
      }

      const modelSpec = (() => {
        try {
          return parseModelSpec(input.model ?? session.defaultModel);
        } catch (err) {
          return err instanceof Error ? err : new Error(String(err));
        }
      })();
      if (modelSpec instanceof Error) {
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] prompt: invalid model spec', {
          providerSessionId: input.providerSessionId,
          message: modelSpec.message,
        });
        yield { type: 'session-end', reason: 'error', error: modelSpec.message };
        return;
      }

      let credential: AiSdkCredential;
      try {
        credential = await ensureCredential(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] prompt: credential resolution failed', {
          providerSessionId: input.providerSessionId,
          vendor: modelSpec.vendor,
          message,
        });
        yield { type: 'session-end', reason: 'error', error: message };
        return;
      }
      if (credential.vendor !== modelSpec.vendor) {
        // If the session's default model and the credential's vendor
        // disagree we surface it clearly — happens when the user picks
        // a model for a vendor they have no key for.
        const message =
          `Credential is for vendor "${credential.vendor}" but the requested ` +
          `model "${modelSpec.raw}" needs vendor "${modelSpec.vendor}". ` +
          'Pick a model from the credential vendor or attach a credential for the requested vendor.';
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] prompt: vendor/credential mismatch', {
          providerSessionId: input.providerSessionId,
          modelVendor: modelSpec.vendor,
          credentialVendor: credential.vendor,
        });
        yield { type: 'session-end', reason: 'error', error: message };
        return;
      }

      let model: unknown;
      try {
        model = resolveModel(modelSpec, credential, vendors);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] resolveModel threw', {
          providerSessionId: input.providerSessionId,
          modelVendor: modelSpec.vendor,
          message,
        });
        yield { type: 'session-end', reason: 'error', error: message };
        return;
      }

      // Lazy workspace accessor handed to the tools factory. Returns the
      // cached handle if the sandbox is already up; otherwise calls the
      // host's `ensureWorkspace` (provision + persist + resolve) once and
      // caches the result on the session so a sandbox booted mid-turn
      // (by `sandbox.start` or the first `sandbox.*` call) is reused by
      // every later tool in the same turn — and by later turns, via the
      // workspace id the host persisted onto the session row.
      const ensureWorkspace: WorkspaceAccessor = async () => {
        if (session.workspace) {
          return session.workspace;
        }
        if (!session.ensureWorkspace) {
          throw new Error(
            '[agents/ai-sdk] a tool requested the sandbox but no workspace ' +
              'provisioner is wired for this session. The host must pass ' +
              '`ensureWorkspace` into createSession (or provide an eager ' +
              '`workspace`) for sandbox.* tools to work.',
          );
        }
        const handle = await session.ensureWorkspace();
        session.workspace = handle;
        return handle;
      };

      // Build the tool catalogue: built-in stubs (echo/now) plus
      // whatever the host's tools factory returns (sandbox tools,
      // flowlib actions, …). Names collide → host-supplied wins;
      // collision is normally unintentional, log it.
      let hostTools: AiSdkToolSet = {};
      if (toolsFactory) {
        try {
          hostTools = await toolsFactory({
            auth: session.auth,
            sessionId: input.providerSessionId,
            ensureWorkspace,
            ...(session.workspace ? { workspace: session.workspace } : {}),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error('[agents/ai-sdk] tools factory threw — proceeding with stubs only', {
            providerSessionId: input.providerSessionId,
            message,
          });
        }
      }
      const stubTools = buildToolSet({
        ...input,
        extraDenied: [...defaultDenied, ...(input.extraDenied ?? [])],
      });
      // Merge stubs < host < plugin-injected tools (`skills.read`,
      // `memory.*`, …, from `input.providerTools`), then apply the
      // default-deny + per-session deny/allow filters uniformly.
      const tools = assembleToolSet({
        stubs: stubTools,
        host: hostTools,
        injected: input.providerTools as AiSdkToolSet | undefined,
        denied: new Set<string>([...defaultDenied, ...(input.extraDenied ?? [])]),
        allowlist:
          input.enabledTools && input.enabledTools.length > 0
            ? new Set<string>(input.enabledTools)
            : null,
        onCollision: (name) => {
          // eslint-disable-next-line no-console
          console.log('[agents/ai-sdk] tool name collision — later source overrides earlier', {
            providerSessionId: input.providerSessionId,
            name,
          });
        },
      });

      // Route every tool's output through the truncation store. Big
      // results spill to the workspace; small ones pass through intact.
      // Read the workspace lazily (`getWorkspace`) so spill targets a
      // sandbox booted mid-turn, without forcing one to boot just to
      // spill — pre-sandbox turns keep large outputs inline.
      const finalTools = wrapToolsWithOutputStore(tools, toolOutputStore, {
        getWorkspace: () => session.workspace,
      });

      // Rewrite dotted tool names to the provider-safe pattern, keeping a
      // reverse map to restore the original id on emitted events.
      const { tools: wireTools, restore: toolNameRestore } = sanitiseToolSet(finalTools);

      // eslint-disable-next-line no-console
      console.log('[agents/ai-sdk] firing streamText…', {
        providerSessionId: input.providerSessionId,
        modelVendor: modelSpec.vendor,
        modelId: modelSpec.modelId,
        toolNames: Object.keys(wireTools),
        partsCount: input.parts.length,
        maxSteps,
        hasSystemPrompt: Boolean(session.systemPrompt),
        elapsedMs: Date.now() - promptStart,
      });

      // `streamText` was statically imported by the host and wired in
      // via `options.streamText`. We checked it's a function at factory
      // construction time; narrow the return value to the surface we
      // care about (`fullStream`).
      const stream = streamText({
        model,
        ...(session.systemPrompt ? { system: session.systemPrompt } : {}),
        messages: buildMessages(input),
        tools: wireTools,
        // Multi-step agentic loop. AI SDK v5/v6 default `streamText` to a
        // SINGLE step (`stepCountIs(1)`) — it runs one tool call but never
        // feeds the result back, so the agent stalls after the first tool
        // (e.g. starts a sandbox, then stops instead of cloning). The v4
        // `maxSteps` option is ignored in v5+. `stopWhen` is the v5/v6 API;
        // we stop once the step count reaches `maxSteps`. Passed inline so
        // the host needn't also wire `stepCountIs`.
        maxSteps,
        stopWhen: ({ steps }: { steps: unknown[] }) => steps.length >= maxSteps,
        abortSignal: input.abortSignal,
      }) as { fullStream: AsyncIterable<unknown> };

      // Translate AI SDK fullStream chunks → AgentEvent. The chunk
      // shapes are stable across @ai-sdk minor versions:
      //   - { type: 'text-delta', text }            → text-delta event
      //   - { type: 'tool-call', toolCallId, toolName, args } → tool-call event
      //   - { type: 'tool-result', toolCallId, result } → tool-result event
      //   - { type: 'finish', usage, finishReason } → message-complete + session-end
      //   - { type: 'error', error }                → session-end (error)
      // Some chunk shapes differ slightly between v4 and v5 of the
      // `ai` package; we read defensively from optional fields.
      const messageId = `msg_${Date.now()}_${randomBytes(4).toString('hex')}`;
      let messageStarted = false;
      let forwardedChunks = 0;
      let usage: { inputTokens?: number; outputTokens?: number } | undefined;
      try {
        for await (const rawChunk of stream.fullStream) {
          const chunk = rawChunk as {
            type?: string;
            text?: string;
            textDelta?: string;
            toolCallId?: string;
            toolName?: string;
            args?: unknown;
            input?: unknown;
            result?: unknown;
            output?: unknown;
            error?: unknown;
            finishReason?: string;
            // AI SDK v5 reports usage in two forms:
            //  - On `step-finish` / `finish`: `usage.{inputTokens, outputTokens, totalTokens}`
            //  - Older shape: `usage.{promptTokens, completionTokens}`
            // Read both and normalise downstream.
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
              promptTokens?: number;
              completionTokens?: number;
            };
          };
          forwardedChunks += 1;
          const chunkType = chunk.type ?? '<no-type>';
          switch (chunkType) {
            case 'text-delta':
            case 'text': {
              const text = chunk.textDelta ?? chunk.text ?? '';
              if (text.length === 0) {
                break;
              }
              if (!messageStarted) {
                messageStarted = true;
              }
              yield { type: 'text-delta', messageId, text };
              break;
            }
            case 'tool-call': {
              const callId = chunk.toolCallId ?? `${messageId}-call-${forwardedChunks}`;
              const wireName = chunk.toolName ?? '<unknown>';
              // Restore the original dotted id (e.g. `sandbox_start` →
              // `sandbox.start`) so downstream renderers + tool matching
              // see the canonical name.
              const name = toolNameRestore.get(wireName) ?? wireName;
              yield {
                type: 'tool-call',
                messageId,
                id: callId,
                name,
                input: chunk.args ?? chunk.input ?? {},
              };
              break;
            }
            case 'tool-result': {
              const callId = chunk.toolCallId ?? `${messageId}-result-${forwardedChunks}`;
              yield {
                type: 'tool-result',
                messageId,
                id: callId,
                output: chunk.result ?? chunk.output ?? null,
                isError: false,
              };
              break;
            }
            case 'tool-error': {
              // A tool's `execute` threw (bad input, missing credential,
              // sandbox failure, …). AI SDK v5 emits this as a distinct
              // chunk; without mapping it the UI's pending tool-call never
              // resolves and shows "Awaiting tool result…" forever. Emit a
              // tool-result flagged as an error so the call closes out.
              const callId = chunk.toolCallId ?? `${messageId}-result-${forwardedChunks}`;
              const err = chunk.error;
              const errorText =
                typeof err === 'string'
                  ? err
                  : err instanceof Error
                    ? err.message
                    : JSON.stringify(err);
              // eslint-disable-next-line no-console
              console.error('[agents/ai-sdk] tool-error chunk', {
                providerSessionId: input.providerSessionId,
                toolCallId: callId,
                errorText,
              });
              yield {
                type: 'tool-result',
                messageId,
                id: callId,
                output: errorText,
                isError: true,
              };
              break;
            }
            case 'error': {
              const err = chunk.error;
              const errorText =
                typeof err === 'string'
                  ? err
                  : err instanceof Error
                    ? err.message
                    : JSON.stringify(err);
              // eslint-disable-next-line no-console
              console.error('[agents/ai-sdk] stream emitted error chunk', {
                providerSessionId: input.providerSessionId,
                errorText,
              });
              if (messageStarted) {
                yield { type: 'message-complete', messageId };
              }
              yield { type: 'session-end', reason: 'error', error: errorText };
              return;
            }
            case 'finish':
            case 'step-finish':
            case 'finish-step': {
              // Read both naming schemes (v5 vs older). step-finish
              // fires per-step in a multi-step turn; finish fires once
              // at the end. We keep the latest seen value — by the
              // time the loop exits, `usage` reflects the final turn.
              const u = chunk.usage;
              if (u) {
                usage = {
                  inputTokens: u.inputTokens ?? u.promptTokens ?? usage?.inputTokens ?? 0,
                  outputTokens: u.outputTokens ?? u.completionTokens ?? usage?.outputTokens ?? 0,
                };
              }
              // Don't return here — `finish` is followed by a
              // `step-finish` / nothing depending on the AI SDK
              // version. Let the loop terminate naturally so we don't
              // miss trailing chunks. We emit message-complete +
              // session-end after the for-await exits.
              break;
            }
            default: {
              // AI SDK lifecycle chunks we deliberately ignore:
              //   `start`, `start-step`, `text-start`, `text-end`,
              //   `tool-input-start`, `tool-input-delta`, `reasoning`,
              //   `reasoning-signature`. Most are internal bookkeeping
              //   that the chat UI doesn't render. New / unexpected
              //   chunk types still warn so we don't quietly miss
              //   useful data.
              const IGNORED_CHUNK_TYPES = new Set([
                'start',
                'start-step',
                'text-start',
                'text-end',
                'tool-input-start',
                'tool-input-delta',
                'reasoning',
                'reasoning-signature',
                'response-metadata',
              ]);
              if (!IGNORED_CHUNK_TYPES.has(chunkType)) {
                // eslint-disable-next-line no-console
                console.log('[agents/ai-sdk] unmapped chunk', {
                  providerSessionId: input.providerSessionId,
                  chunkType,
                  forwardedChunks,
                });
              }
              break;
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[agents/ai-sdk] stream threw', {
          providerSessionId: input.providerSessionId,
          forwardedChunks,
          elapsedMs: Date.now() - promptStart,
          message,
        });
        if (messageStarted) {
          yield { type: 'message-complete', messageId };
        }
        yield { type: 'session-end', reason: 'error', error: message };
        return;
      }

      if (messageStarted) {
        yield {
          type: 'message-complete',
          messageId,
          ...(usage
            ? {
                usage: {
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                },
              }
            : {}),
        };
      }
      yield {
        type: 'session-end',
        reason: input.abortSignal.aborted ? 'stopped' : 'completed',
      };

      // eslint-disable-next-line no-console
      console.log('[agents/ai-sdk] prompt turn complete', {
        providerSessionId: input.providerSessionId,
        messageId,
        forwardedChunks,
        usage,
        elapsedMs: Date.now() - promptStart,
      });
    },

    async listMessages(_input: ListMessagesInput): Promise<AgentProviderMessage[]> {
      // Chat history lives in `AIChatAgent.messages` (DO storage),
      // not in this provider. Return empty so the orchestrator falls
      // back to the SDK's stored history.
      return [];
    },

    async listModels() {
      // Surface the host-declared model list to the picker (via
      // `GET /agents/providers`). Hosts curate this in `aiSdkProvider({
      // models })` so the catalogue matches their credential/gateway
      // setup (e.g. `openrouter/...` specs for an OpenRouter key). We
      // don't call per-vendor `models.list` — the curated list is the
      // source of truth.
      return (options.models ?? []).map((m) => ({
        id: m.id,
        name: m.label,
        ...(m.description ? { metadata: { description: m.description } } : {}),
      }));
    },

    async closeSession(providerSessionId: string): Promise<void> {
      sessionsById.delete(providerSessionId);
    },
  };
}
