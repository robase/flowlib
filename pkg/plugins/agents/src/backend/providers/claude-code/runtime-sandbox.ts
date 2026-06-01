/**
 * Sandbox-mode runtime adapter for `claudeCodeProvider`.
 *
 * Mirrors the in-process `runtime.ts` `ClaudeSession` shape but proxies
 * every operation to an in-container HTTP server (see
 * `runtime/claude-code-server/server.mjs`) reached via the workspace
 * handle's `metadata.getClaudeCode()`.
 *
 * Why a parallel implementation: Cloudflare Workers can't spawn child
 * processes, so the in-process SDK path doesn't run in the production
 * deployment. The host calls into the sandbox container, which runs
 * the SDK on its behalf and streams `SDKMessage`s back as SSE.
 *
 * Limitations vs the in-process path (v1):
 *   - `setPermissionHandler` is a no-op — the in-container server
 *     defaults to `acceptEdits` and doesn't round-trip canUseTool back
 *     to the host. The kernel's HIL flow is in-process-only.
 *   - `mcpServers` / `hooks` are accepted at session-create but only
 *     forwarded if JSON-serialisable. v1 sends neither.
 *   - `setPermissionMode` is a no-op (the server fixes mode at create).
 */

import type { WorkspaceHandle } from '../../workspaces/types';
import type {
  ClaudePermissionHandler,
  ClaudePermissionMode,
  ClaudeSession,
  CreateClaudeSessionInput,
} from './runtime';

/**
 * Shape of the workspace metadata we consume. Matches
 * `CloudflareSandboxClaudeHandle.metadata.getClaudeCode()`.
 */
interface ClaudeServerClient {
  baseUrl: string;
  fetch(
    path: string,
    init?: { method?: string; body?: string; signal?: AbortSignal },
  ): Promise<{
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
}

interface ClaudeServerBundle {
  client: ClaudeServerClient;
  server: { close(): Promise<void> };
}

interface SandboxClaudeMetadata {
  getClaudeCode?: (options?: Record<string, unknown>) => Promise<ClaudeServerBundle>;
}

/**
 * Detect whether the workspace handle is the claude-flavoured sandbox.
 * Returns the typed `getClaudeCode` accessor if so, else undefined.
 */
export function tryGetClaudeServerAccessor(
  workspace: WorkspaceHandle | undefined,
): SandboxClaudeMetadata['getClaudeCode'] | undefined {
  if (!workspace) {
    return undefined;
  }
  const meta = workspace.metadata as SandboxClaudeMetadata | undefined;
  return typeof meta?.getClaudeCode === 'function' ? meta.getClaudeCode : undefined;
}

/**
 * Create a session that talks to the in-container claude-code server.
 *
 * Throws if the workspace handle doesn't expose `getClaudeCode` or if
 * the server fails to respond to the create request.
 */
export async function createClaudeSandboxSession(
  input: CreateClaudeSessionInput & {
    workspace: WorkspaceHandle;
  },
): Promise<ClaudeSession> {
  const accessor = tryGetClaudeServerAccessor(input.workspace);
  if (!accessor) {
    throw new Error(
      '[agents/claude-code] sandbox session requires a workspace whose metadata exposes ' +
        '`getClaudeCode` — was the workspace created via cloudflareSandboxClaude?',
    );
  }

  const bundle = await accessor();

  const createResp = await bundle.client.fetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      apiKey: input.apiKey,
      systemPrompt: input.systemPrompt,
      permissionMode: input.permissionMode ?? 'acceptEdits',
      defaultModel: input.defaultModel,
      allowedTools: input.allowedTools,
      disallowedTools: input.disallowedTools,
      cwd: input.cwd,
    }),
  });

  if (createResp.status !== 201) {
    const body = await createResp.text().catch(() => '');
    throw new Error(
      `[agents/claude-code] in-container session create failed (HTTP ${createResp.status}): ${body}`,
    );
  }

  const created = JSON.parse(await createResp.text()) as { sessionId?: string };
  if (!created.sessionId) {
    throw new Error('[agents/claude-code] in-container session create returned no sessionId');
  }

  const sessionId = created.sessionId;
  let closed = false;

  const session: ClaudeSession = {
    get sessionId() {
      return sessionId;
    },

    async *run(turn) {
      if (closed) {
        throw new Error('[agents/claude-code] session is closed');
      }

      const resp = await bundle.client.fetch(`/sessions/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text: turn.text, model: turn.model }),
        signal: turn.signal,
      });

      if (resp.status !== 200) {
        const body = await resp.text().catch(() => '');
        throw new Error(
          `[agents/claude-code] in-container prompt failed (HTTP ${resp.status}): ${body}`,
        );
      }

      const body = resp.body;
      if (!body) {
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      try {
        while (true) {
          if (turn.signal.aborted) {
            break;
          }
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          // SSE frame split: blank line ("\n\n") terminates a frame.
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) {
              continue;
            }
            const payloadText = dataLine.slice(5).trim();
            if (!payloadText) {
              continue;
            }
            let payload: { type?: string; message?: unknown };
            try {
              payload = JSON.parse(payloadText);
            } catch {
              continue;
            }
            if (payload.type === 'end') {
              return;
            }
            if (payload.type === 'error') {
              throw new Error(
                `[agents/claude-code] in-container error: ${
                  (payload as { message?: string }).message ?? 'unknown'
                }`,
              );
            }
            if (payload.type === 'sdk-message' && payload.message) {
              yield payload.message as never;
            }
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
      }
    },

    async interrupt() {
      // The in-container server treats HTTP request abort as
      // interrupt; an explicit interrupt RPC isn't wired in v1.
    },

    async setPermissionMode(_mode: ClaudePermissionMode) {
      // No-op — the in-container server fixes permissionMode at create
      // time. v2 can wire a PATCH /sessions/:id endpoint.
    },

    setPermissionHandler(_handler: ClaudePermissionHandler | undefined) {
      // No-op — permission round-trips are in-process-only in v1.
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        await bundle.client.fetch(`/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
        });
      } catch {
        // Best-effort. Sandbox container may already be sleeping.
      }
    },
  };

  return session;
}
