/**
 * Claude Code SDK runtime adapter.
 *
 * Owns the lifecycle of the underlying `@anthropic-ai/claude-agent-sdk`
 * `Query` objects — one per agents-plugin session. The SDK is loaded
 * **lazily** on the first call to `createClaudeSession` so consumers
 * who don't enable the Claude provider don't pay the SDK install /
 * bundle cost.
 *
 * Architecture:
 *
 * - One `Query` per session. The SDK's `query()` returns an
 *   `AsyncGenerator<SDKMessage>` paired with control methods
 *   (`interrupt`, `setPermissionMode`, `setModel`, …). We pair this
 *   with an in-memory queue of pending user messages so multi-turn
 *   streaming input works: each call to `prompt()` pushes a new
 *   `SDKUserMessage` onto the queue and the SDK consumes them in
 *   order.
 *
 * - `ClaudeSession.run(promptText)` returns an `AsyncIterable` of
 *   `SDKMessage`s scoped to that turn — i.e. starting from the user
 *   message we just enqueued and ending at the next `result` message.
 *   The provider layer wraps that with the events mapper.
 *
 * - Permission-mode `default` triggers the SDK's `canUseTool`
 *   callback, which the runtime forwards to a caller-supplied
 *   permission handler. The agents-plugin v1 default is `acceptEdits`
 *   so the callback never fires; the handler is a future seam for the
 *   HIL flow (Stream HIL1, Phase 5).
 */

// We keep all SDK-specific types loose at module load. The real types
// are imported lazily inside `loadSdk()` via dynamic `import()`.
type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');
type SdkQuery = ReturnType<SdkModule['query']>;
type SdkMessage = Awaited<ReturnType<SdkQuery['next']>>['value'] extends infer V ? V : unknown;
type SdkUserMessage = Parameters<SdkModule['query']>[0]['prompt'] extends (infer P) | string
  ? P extends AsyncIterable<infer U>
    ? U
    : unknown
  : unknown;
type SdkOptions = NonNullable<Parameters<SdkModule['query']>[0]['options']>;
type SdkPermissionMode = NonNullable<SdkOptions['permissionMode']>;
type SdkCanUseTool = NonNullable<SdkOptions['canUseTool']>;

// Re-exported for the provider layer.
export type ClaudePermissionMode = SdkPermissionMode;

/**
 * Lazy SDK loader — first call performs the dynamic import, subsequent
 * calls return the cached module. Errors are propagated to the caller
 * with a clearer message so misconfigured deployments fail loud.
 */
let cachedSdk: SdkModule | undefined;
async function loadSdk(): Promise<SdkModule> {
  if (cachedSdk) {
    return cachedSdk;
  }
  try {
    cachedSdk = await import('@anthropic-ai/claude-agent-sdk');
    return cachedSdk;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[agents/claude-code] failed to load @anthropic-ai/claude-agent-sdk — ` +
        `is the optional peer dependency installed? (${reason})`,
    );
  }
}

/**
 * Permission handler called when the SDK asks us whether a tool can
 * run. Receives the tool name + input; returns `allow` / `deny`.
 *
 * v1 default: not invoked (provider uses `permissionMode: 'acceptEdits'`).
 * v1 HIL escape hatch: when supplied, the runtime forwards every
 * permission request through this handler. The handler can yield a
 * `permission-request` event upstream + await the user's reply.
 */
export type ClaudePermissionHandler = (req: {
  toolName: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
}) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message?: string }>;

/**
 * Inputs for `createClaudeSession`. Mirrors the SDK's `Options` but
 * with the agents-plugin's plumbing wrapping it.
 */
export interface CreateClaudeSessionInput {
  /** Anthropic API key (decrypted from the Flowlib credential). */
  apiKey: string;
  /** Workspace cwd — required for file-editing sessions. */
  cwd?: string;
  /** System prompt assembled by the prompt composer (Stream K). */
  systemPrompt?: string;
  /** Permission mode. Default `acceptEdits` for v1 (skip canUseTool). */
  permissionMode?: ClaudePermissionMode;
  /** Default model for the session — overridable per turn via `setModel`. */
  defaultModel?: string;
  /** Hard tool deny list (in addition to per-role denies). */
  disallowedTools?: string[];
  /** Whitelist mode — when set, ONLY these tools are usable. */
  allowedTools?: string[];
  /** SDK MCP server registrations (in-process or stdio). */
  mcpServers?: SdkOptions['mcpServers'];
  /** SDK hook registrations (PreToolUse / PostToolUse / FileChanged / …). */
  hooks?: SdkOptions['hooks'];
  /** Permission handler — only invoked when permissionMode === 'default'. */
  onPermissionRequest?: ClaudePermissionHandler;
  /** External abort signal — typically the session-scoped controller. */
  abortSignal?: AbortSignal;
}

/** A handle to a live Claude SDK session. */
export interface ClaudeSession {
  /** SDK session id (set by the SDK on first message; opaque). */
  readonly sessionId: string;

  /**
   * Push a user prompt and stream the resulting `SDKMessage`s for that
   * turn only. Caller iterates the returned async iterable; the
   * iteration ends at the first `result` message (success or error)
   * or when `signal` aborts.
   */
  run(input: { text: string; signal: AbortSignal; model?: string }): AsyncIterable<SdkMessage>;

  /** Cancel the in-flight turn (if any). */
  interrupt(): Promise<void>;

  /** Update the active permission mode. */
  setPermissionMode(mode: ClaudePermissionMode): Promise<void>;

  /**
   * Swap the active permission handler (canUseTool callback).
   *
   * Called by the kernel before turn-start to wire a fresh handler that
   * emits `permission-request` `AgentEvent`s out of the in-flight
   * iterator and awaits the user's decision. Pass `undefined` to clear
   * the handler — the SDK will fall back to its default behaviour
   * (which depends on `permissionMode`).
   *
   * Note: the SDK fixes its `canUseTool` option at `query()` creation
   * time; we route every call through a mutable holder so swapping
   * handlers takes effect for the *next* tool-use request without
   * recreating the Query.
   */
  setPermissionHandler(handler: ClaudePermissionHandler | undefined): void;

  /** Close the session — drains the input queue and stops the generator. */
  close(): Promise<void>;
}

/**
 * Build a new Claude session. The underlying SDK `query()` is invoked
 * once here; subsequent prompts push into a shared input queue.
 *
 * **Lazy:** the SDK is only `import()`-ed inside this function.
 */
export async function createClaudeSession(input: CreateClaudeSessionInput): Promise<ClaudeSession> {
  const sdk = await loadSdk();

  // Per-session state — guarded so concurrent calls behave.
  const queue = createUserMessageQueue();
  let sdkSessionId: string | undefined;
  let closed = false;

  // Permission-handler holder. The SDK fixes `canUseTool` at query()
  // creation time, so we always register a callback that dispatches
  // through a mutable holder. The kernel can swap handlers between
  // turns via `setPermissionHandler()` without recreating the Query.
  //
  // Behaviour when the holder is `undefined`: we return `behavior: 'allow'`,
  // which is equivalent to "no host-level permission policy" — the
  // SDK's own `permissionMode` (`acceptEdits`, `default`, …) and the
  // platform hooks layer (Stream A) decide what actually runs.
  let permissionHandler: ClaudePermissionHandler | undefined = input.onPermissionRequest;

  const canUseTool: SdkCanUseTool = async (toolName, toolInput, opts) => {
    const handler = permissionHandler;
    if (!handler) {
      return { behavior: 'allow' };
    }
    const decision = await handler({
      toolName,
      input: toolInput,
      signal: opts.signal,
    });
    if (decision.behavior === 'allow') {
      return { behavior: 'allow' };
    }
    return {
      behavior: 'deny',
      message: decision.message ?? 'denied by host',
    };
  };

  const options: SdkOptions = {
    cwd: input.cwd,
    systemPrompt: input.systemPrompt
      ? { type: 'preset', preset: 'claude_code', append: input.systemPrompt }
      : undefined,
    permissionMode: input.permissionMode ?? 'acceptEdits',
    model: input.defaultModel,
    allowedTools: input.allowedTools ? [...input.allowedTools] : undefined,
    disallowedTools: input.disallowedTools ? [...input.disallowedTools] : undefined,
    mcpServers: input.mcpServers,
    hooks: input.hooks,
    canUseTool,
    env: {
      // The SDK reads ANTHROPIC_API_KEY from env; we plumb the
      // decrypted credential through here. We also identify ourselves
      // for User-Agent reporting.
      ...(typeof process !== 'undefined' ? process.env : {}),
      ANTHROPIC_API_KEY: input.apiKey,
      CLAUDE_AGENT_SDK_CLIENT_APP: '@flowlib/agents/0.0.1',
    },
  };

  // Wire external abort into the SDK via its abortController slot.
  if (input.abortSignal) {
    const ac = new AbortController();
    options.abortController = ac;
    if (input.abortSignal.aborted) {
      ac.abort();
    } else {
      input.abortSignal.addEventListener('abort', () => ac.abort(), { once: true });
    }
  }

  const query = sdk.query({ prompt: queue.iterable as AsyncIterable<SdkUserMessage>, options });

  return {
    get sessionId() {
      // Until the SDK emits its first message we don't know the id;
      // callers that need the id pre-prompt can rely on a deterministic
      // placeholder until `run()` resolves it.
      return sdkSessionId ?? 'pending';
    },

    async *run(turn) {
      if (closed) {
        throw new Error('[agents/claude-code] session is closed');
      }

      // Optional per-turn model override.
      if (turn.model) {
        try {
          await query.setModel(turn.model);
        } catch {
          // Non-fatal — the SDK rejects setModel outside streaming
          // input mode; we fall back to the session default.
        }
      }

      queue.push(asUserMessage(turn.text));

      try {
        for await (const msg of iterateUntilResult(query, turn.signal)) {
          // Capture the session id off the first message that exposes one.
          if (!sdkSessionId) {
            const candidate = (msg as { session_id?: string })?.session_id;
            if (typeof candidate === 'string') {
              sdkSessionId = candidate;
            }
          }
          yield msg as SdkMessage;
        }
      } catch (err) {
        if (turn.signal.aborted) {
          // Translate to a SDK-shaped result so the events mapper
          // produces a clean message-complete + the provider can emit
          // the matching session-end event.
          return;
        }
        throw err;
      }
    },

    async interrupt() {
      try {
        await query.interrupt();
      } catch {
        // SDK throws if not in streaming input mode — swallow.
      }
    },

    async setPermissionMode(mode) {
      try {
        await query.setPermissionMode(mode);
      } catch {
        // Same swallow rationale as interrupt().
      }
    },

    setPermissionHandler(handler) {
      permissionHandler = handler;
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      queue.close();
      // Best-effort drain — Query exposes `return()` via the
      // AsyncGenerator contract.
      try {
        await query.return(undefined);
      } catch {
        /* noop */
      }
    },
  };
}

// ─── Internals ─────────────────────────────────────────────────────────

/**
 * Streaming-input adapter. The SDK consumes an
 * `AsyncIterable<SDKUserMessage>`; we wrap a buffered queue so callers
 * can push synchronously and the SDK reads at its own pace.
 *
 * Closing the queue ends the iterable, which terminates the SDK's
 * input phase (and hence the whole `Query`).
 */
interface UserMessageQueue {
  iterable: AsyncIterable<unknown>;
  push(msg: unknown): void;
  close(): void;
}

function createUserMessageQueue(): UserMessageQueue {
  const buffer: unknown[] = [];
  const waiters: Array<(v: IteratorResult<unknown>) => void> = [];
  let closedFlag = false;

  function deliver(value: unknown): void {
    const w = waiters.shift();
    if (w) {
      w({ value, done: false });
    } else {
      buffer.push(value);
    }
  }

  function deliverDone(): void {
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) {
        w({ value: undefined, done: true });
      }
    }
  }

  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift(), done: false });
          }
          if (closedFlag) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => waiters.push(resolve));
        },
        return(): Promise<IteratorResult<unknown>> {
          closedFlag = true;
          deliverDone();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return {
    iterable,
    push(msg) {
      if (closedFlag) {
        return;
      }
      deliver(msg);
    },
    close() {
      closedFlag = true;
      deliverDone();
    },
  };
}

/**
 * Wrap raw text in an SDKUserMessage shape. The SDK's
 * `MessageParam.content` accepts a string directly, so the simplest
 * shape works for v1.
 */
function asUserMessage(text: string): unknown {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
  };
}

/**
 * Iterate the SDK query until we hit a `result` message (turn boundary)
 * or the signal aborts. The SDK keeps the generator open across turns
 * in streaming-input mode, so we slice it manually.
 */
async function* iterateUntilResult(
  query: SdkQuery,
  signal: AbortSignal,
): AsyncGenerator<unknown, void, void> {
  while (true) {
    if (signal.aborted) {
      return;
    }
    const next = await query.next();
    if (next.done) {
      return;
    }
    const msg = next.value as { type?: string };
    yield msg;
    if (msg?.type === 'result') {
      return;
    }
  }
}
