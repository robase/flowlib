/**
 * Local type shim for the `AIChatAgent` base class.
 *
 * `agents@^0.12.3` re-exports `AIChatAgent` from the optional peer
 * dep `@cloudflare/ai-chat`. Consumer Workers install
 * `@cloudflare/ai-chat` directly when they deploy. This plugin
 * does **not** install it as a hard dep so single-tenant Node hosts
 * never pull workerd-only packages.
 *
 * To keep the plugin's `tsc --emitDeclarationOnly` step happy without
 * forcing `@cloudflare/ai-chat` into the dep graph, we declare the
 * minimum API surface this plugin uses below. The runtime resolution
 * is the consumer's responsibility — if they extend `AgentChatDO` or
 * re-export it from a Worker, they install `@cloudflare/ai-chat`
 * alongside `agents` and the real class supplies the implementation.
 *
 * If/when `@cloudflare/ai-chat` becomes a hard dep, delete this file.
 */

declare module '@cloudflare/ai-chat' {
  import type { Agent, AgentContext, Connection, ConnectionContext } from 'agents';

  /**
   * Loose stand-in for AI SDK's `UIMessage`. We only access `.id` and
   * `.role`, never any of the structured parts, so a permissive shape
   * is enough for typecheck.
   */
  export interface UIMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool' | (string & {});
    parts?: unknown;
    [key: string]: unknown;
  }

  /** Loose stand-in for AI SDK's `ToolSet`. */
  export type ToolSet = Record<string, unknown>;

  /** Loose stand-in for AI SDK's `StreamTextOnFinishCallback`. */
  export type StreamTextOnFinishCallback<_T> = (result: {
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    text?: string;
  }) => void | Promise<void>;

  /** Subset of `OnChatMessageOptions` we depend on. */
  export interface OnChatMessageOptions {
    abortSignal?: AbortSignal;
    clientTools?: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }

  /**
   * Base class for chat-style Durable Objects in the Cloudflare Agents
   * SDK. Manages WebSocket lifecycle (`useAgent` connections), message
   * persistence in DO SQL, and the abort/finish wiring.
   *
   * `onChatMessage(onFinish, options)` is the **single override point**:
   * it receives the full message history on `this.messages`, returns
   * a `Response` (typically a streamed AI SDK response), and calls
   * `onFinish` once the stream resolves so the SDK can persist the
   * assistant message.
   */
  export class AIChatAgent<Env = unknown, State = unknown> extends Agent<
    Env extends Cloudflare.Env ? Env : Cloudflare.Env,
    State
  > {
    /** Chat history maintained by the SDK across hibernations. */
    messages: UIMessage[];

    constructor(ctx: AgentContext, env: Env);

    /**
     * Override this to handle an incoming user message. Return a
     * `Response` to stream back, or `undefined` to fall back to the
     * SDK's default echo behaviour.
     */
    onChatMessage(
      onFinish: StreamTextOnFinishCallback<ToolSet>,
      options?: OnChatMessageOptions,
    ): Promise<Response | undefined>;

    /** Persist additional messages outside of `onChatMessage`. */
    saveMessages(messages: UIMessage[]): Promise<void>;
    persistMessages(messages: UIMessage[], excludeBroadcastIds?: string[]): Promise<void>;

    /** WebSocket connection lifecycle (inherited; declared here for ergonomics). */
    onConnect(connection: Connection, ctx: ConnectionContext): Promise<void>;
  }

  export function createToolsFromClientSchemas(
    clientTools?: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>,
  ): ToolSet;
}

declare module 'agents/ai-chat-agent' {
  export * from '@cloudflare/ai-chat';
}
