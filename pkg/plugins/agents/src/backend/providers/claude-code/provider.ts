/**
 * `claudeCodeProvider` — `AgentProvider` implementation backed by
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * The factory returns a singleton `AgentProvider` that:
 *
 * 1. Lazily loads the SDK on first session creation (see `runtime.ts`).
 * 2. Resolves the Anthropic API key from a Flowlib credential via the
 *    `apiKeyResolver` callback the host supplies. This keeps the
 *    provider independent of `@flowlib/core` internals — the host
 *    wires it to `flowlib.credentials.getDecryptedWithRefresh()` at
 *    plugin init time (Stream B / `register.ts`).
 * 3. Caches one `ClaudeSession` per `providerSessionId` and translates
 *    `SDKMessage`s to `AgentEvent`s on the way out.
 */

import type {
  AgentProvider,
  AgentProviderConfig,
  AgentCapabilities,
  CreateSessionInput,
  PromptInput,
  AgentModel,
} from '../types';
import type { AgentEvent } from '../../../shared/events';
import {
  createClaudeSession,
  type ClaudePermissionHandler,
  type ClaudeSession,
  type ClaudePermissionMode,
} from './runtime';
import {
  mapSdkMessage,
  isFileEditTool,
  extractFileEditPath,
  extractFileEditContents,
  type SdkMessageLike,
} from './events';

// ─── Public factory options ────────────────────────────────────────────

/**
 * Validated agent-row config — the shape `validateConfig` enforces.
 *
 * `defaultModel` and `permissionMode` mirror the SDK's options; both
 * are optional in v1 and fall back to provider-level defaults.
 */
export interface ClaudeCodeAgentConfig extends AgentProviderConfig {
  /** Default model for this agent (e.g. `claude-sonnet-4-5`). */
  defaultModel?: string;
  /** Permission mode for the SDK. v1 default: `acceptEdits`. */
  permissionMode?: ClaudePermissionMode;
  /** Hard tool deny-list set on agent definition. */
  disallowedTools?: string[];
  /** Whitelist mode — when set, ONLY these tools are usable. */
  allowedTools?: string[];
}

/**
 * Resolver callback the host supplies. Returns the decrypted API key
 * for the given Flowlib credential. Encapsulating this as a callback
 * keeps the provider testable + decoupled from `@flowlib/core`.
 */
export type ApiKeyResolver = (credentialId: string) => Promise<string>;

export interface ClaudeCodeProviderOptions {
  /** Flowlib credential id used to source the Anthropic API key. */
  credentialId: string;
  /**
   * Async resolver from credential id → decrypted API key. Wired by
   * the host to `flowlib.credentials.getDecryptedWithRefresh()`.
   */
  apiKeyResolver: ApiKeyResolver;
  /** Provider-level default model (overridable per agent + per turn). */
  defaultModel?: string;
  /** Optional logger; defaults to console.debug at debug level. */
  logger?: {
    debug?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

// ─── Capabilities ──────────────────────────────────────────────────────

const CLAUDE_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  toolUse: true,
  mcpServers: true,
  parallelToolCalls: true,
  fileEdits: true,
  resumableStream: true,
  workspaceRequired: true,
  permissionPrompts: true,
};

// ─── Built-in model list (rough, surfaced via `listModels`) ────────────

const DEFAULT_MODELS: ReadonlyArray<AgentModel> = [
  {
    id: 'claude-code/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    contextWindow: 200_000,
    metadata: { vendor: 'anthropic', tier: 'sonnet' },
  },
  {
    id: 'claude-code/claude-opus-4-5',
    name: 'Claude Opus 4.5',
    contextWindow: 200_000,
    metadata: { vendor: 'anthropic', tier: 'opus' },
  },
  {
    id: 'claude-code/claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    metadata: { vendor: 'anthropic', tier: 'haiku' },
  },
];

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * Extended provider surface for `claudeCodeProvider`. Adds a
 * `setPermissionHandler(sessionId, handler)` method on top of the
 * standard {@link AgentProvider} contract — the orchestration kernel
 * uses this to install a fresh `canUseTool` callback before each
 * turn-start, so `permission-request` `AgentEvent`s can be surfaced
 * out of the in-flight iterator and the user's allow/deny decision
 * can be plumbed back into the SDK.
 *
 * The interface is intentionally open: the standard kernel path
 * (`runTurn` in `service/run-turn.ts`) feature-detects this method
 * and falls back to the SDK's built-in permission flow when the
 * provider doesn't expose it (e.g. opencode).
 */
export interface ClaudeCodeAgentProvider extends AgentProvider {
  /**
   * Swap the permission handler for a previously-created session.
   *
   * Returns `true` when the handler was installed; `false` when the
   * session id is unknown (e.g. already closed). Pass `undefined` for
   * `handler` to clear the handler — the SDK then falls back to its
   * `permissionMode`-driven default.
   */
  setPermissionHandler(
    providerSessionId: string,
    handler: ClaudePermissionHandler | undefined,
  ): boolean;
}

export function claudeCodeProvider(options: ClaudeCodeProviderOptions): ClaudeCodeAgentProvider {
  if (!options.credentialId || typeof options.credentialId !== 'string') {
    throw new Error('[agents/claude-code] claudeCodeProvider({ credentialId }) is required');
  }
  if (typeof options.apiKeyResolver !== 'function') {
    throw new Error(
      '[agents/claude-code] claudeCodeProvider({ apiKeyResolver }) is required — ' +
        'wire to flowlib.credentials.getDecryptedWithRefresh() at plugin init',
    );
  }

  const logger = options.logger ?? {};

  // providerSessionId → live ClaudeSession.
  const sessions = new Map<string, ClaudeSession>();

  /**
   * Synthesise a unique provider session id. The SDK assigns its own
   * id once the first message flows; we keep our own deterministic
   * handle so callers can reference the session before the first
   * round-trip completes.
   */
  function newProviderSessionId(): string {
    const c =
      typeof globalThis !== 'undefined'
        ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
        : undefined;
    return c?.randomUUID?.() ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'Bot',
    capabilities: CLAUDE_CAPABILITIES,

    validateConfig(raw: unknown): AgentProviderConfig {
      const cfg = (raw ?? {}) as Record<string, unknown>;
      const out: ClaudeCodeAgentConfig = {};

      if (cfg.defaultModel !== undefined) {
        if (typeof cfg.defaultModel !== 'string') {
          throw new Error('[agents/claude-code] defaultModel must be a string');
        }
        out.defaultModel = cfg.defaultModel;
      }

      if (cfg.permissionMode !== undefined) {
        const valid: ClaudePermissionMode[] = [
          'default',
          'acceptEdits',
          'bypassPermissions',
          'plan',
          'dontAsk',
          'auto',
        ];
        if (!valid.includes(cfg.permissionMode as ClaudePermissionMode)) {
          throw new Error(
            `[agents/claude-code] permissionMode must be one of: ${valid.join(', ')}`,
          );
        }
        out.permissionMode = cfg.permissionMode as ClaudePermissionMode;
      }

      if (cfg.disallowedTools !== undefined) {
        if (
          !Array.isArray(cfg.disallowedTools) ||
          !cfg.disallowedTools.every((t) => typeof t === 'string')
        ) {
          throw new Error('[agents/claude-code] disallowedTools must be an array of strings');
        }
        out.disallowedTools = [...(cfg.disallowedTools as string[])];
      }

      if (cfg.allowedTools !== undefined) {
        if (
          !Array.isArray(cfg.allowedTools) ||
          !cfg.allowedTools.every((t) => typeof t === 'string')
        ) {
          throw new Error('[agents/claude-code] allowedTools must be an array of strings');
        }
        out.allowedTools = [...(cfg.allowedTools as string[])];
      }

      return out;
    },

    async createSession(input: CreateSessionInput) {
      const cfg = input.config as ClaudeCodeAgentConfig;
      const apiKey = await options.apiKeyResolver(options.credentialId);
      if (!apiKey) {
        throw new Error(
          `[agents/claude-code] credential "${options.credentialId}" did not resolve to an API key`,
        );
      }

      // Workspace is required (capabilities.workspaceRequired = true);
      // surface a clear error early instead of letting the SDK fail later.
      const workspace = input.workspace;
      if (!workspace) {
        throw new Error(
          '[agents/claude-code] createSession requires a workspace (capabilities.workspaceRequired)',
        );
      }

      const providerSessionId = newProviderSessionId();
      const extras = (input.extras ?? {}) as {
        permissionMode?: ClaudePermissionMode;
        mcpServers?: unknown;
        hooks?: unknown;
      };

      const session = await createClaudeSession({
        apiKey,
        cwd: workspace.rootPath,
        systemPrompt: input.systemPrompt,
        permissionMode: extras.permissionMode ?? cfg.permissionMode ?? 'acceptEdits',
        defaultModel: cfg.defaultModel ?? options.defaultModel,
        disallowedTools: cfg.disallowedTools,
        allowedTools: cfg.allowedTools,
        // mcpServers / hooks are passed straight through — the SDK's
        // typings carry the canonical shape and the agents-plugin's
        // hook bridge (Stream S1) and MCP bridge (Stream G) supply
        // them at session-create time.
        mcpServers: extras.mcpServers as never,
        hooks: extras.hooks as never,
      });

      sessions.set(providerSessionId, session);
      logger.debug?.('[agents/claude-code] session created', {
        providerSessionId,
        cwd: workspace.rootPath,
      });

      return { providerSessionId };
    },

    async *prompt(input: PromptInput): AsyncIterable<AgentEvent> {
      const session = sessions.get(input.providerSessionId);
      if (!session) {
        yield {
          type: 'session-end',
          reason: 'error',
          error: `unknown providerSessionId: ${input.providerSessionId}`,
        };
        return;
      }

      const text = input.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      if (!text) {
        yield {
          type: 'session-end',
          reason: 'error',
          error: 'claudeCodeProvider.prompt requires at least one text part',
        };
        return;
      }

      // Track in-flight tool-use inputs so the runtime can synthesise
      // file-edit events when a Write/Edit/MultiEdit tool result lands.
      const pendingFileEdits = new Map<
        string,
        { messageId: string; toolName: string; input: unknown }
      >();

      let endReason: 'completed' | 'stopped' | 'error' = 'completed';
      let errorMessage: string | undefined;

      try {
        for await (const sdkMsg of session.run({
          text,
          signal: input.abortSignal,
          model: input.model,
        })) {
          const events = mapSdkMessage(sdkMsg as SdkMessageLike, logger);
          for (const ev of events) {
            yield ev;

            // File-edit synthesis: track tool-use, then on matching
            // tool-result emit a synthesised file-edit event.
            if (ev.type === 'tool-call' && isFileEditTool(ev.name)) {
              const path = extractFileEditPath(ev.input);
              if (path) {
                pendingFileEdits.set(ev.id, {
                  messageId: ev.messageId,
                  toolName: ev.name,
                  input: ev.input,
                });
              }
            } else if (ev.type === 'tool-result') {
              const pending = pendingFileEdits.get(ev.id);
              if (pending && !ev.isError) {
                const path = extractFileEditPath(pending.input);
                const { before, after } = extractFileEditContents(pending.toolName, pending.input);
                if (path) {
                  yield {
                    type: 'file-edit',
                    messageId: pending.messageId,
                    path,
                    ...(before !== undefined ? { before } : {}),
                    ...(after !== undefined ? { after } : {}),
                  };
                }
                pendingFileEdits.delete(ev.id);
              }
            }
          }
        }

        if (input.abortSignal.aborted) {
          endReason = 'stopped';
        }
      } catch (err) {
        endReason = 'error';
        errorMessage = err instanceof Error ? err.message : String(err);
        logger.error?.('[agents/claude-code] prompt iteration threw', {
          error: errorMessage,
        });
      }

      yield {
        type: 'session-end',
        reason: endReason,
        ...(errorMessage ? { error: errorMessage } : {}),
      };
    },

    async listMessages() {
      // SDK exposes `getSessionMessages(sessionId)` but mapping it
      // back into `AgentProviderMessage` is non-trivial (different
      // content-block shapes). v1 returns an empty list — the agents
      // plugin persists its own messages via `PersistenceCallbacks`,
      // so the UI does not need provider-side history for the file-
      // editing providers.
      return [];
    },

    async listModels() {
      return [...DEFAULT_MODELS];
    },

    async closeSession(providerSessionId: string) {
      const session = sessions.get(providerSessionId);
      if (!session) {
        return;
      }
      sessions.delete(providerSessionId);
      try {
        await session.close();
      } catch (err) {
        logger.warn?.('[agents/claude-code] closeSession threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async shutdown() {
      const all = Array.from(sessions.values());
      sessions.clear();
      await Promise.allSettled(all.map((s) => s.close()));
    },

    setPermissionHandler(
      providerSessionId: string,
      handler: ClaudePermissionHandler | undefined,
    ): boolean {
      const session = sessions.get(providerSessionId);
      if (!session) {
        return false;
      }
      session.setPermissionHandler(handler);
      return true;
    },
  };
}
