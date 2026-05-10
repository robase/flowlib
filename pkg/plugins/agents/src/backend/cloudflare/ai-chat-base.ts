/// <reference types="@cloudflare/workers-types" />
/**
 * Indirection layer over `agents/ai-chat-agent`'s `AIChatAgent`.
 *
 * # Why this file exists
 *
 * The Cloudflare Agents SDK (`agents@>=0.12`) re-exports `AIChatAgent`
 * from the **optional peer dep** `@cloudflare/ai-chat`. Consumer
 * Workers (e.g. the deferred `examples/cloudflare-*`) install
 * `@cloudflare/ai-chat` directly when they deploy. This plugin
 * deliberately does NOT pull `@cloudflare/ai-chat` into its hard
 * dependencies so single-tenant Node hosts never bundle workerd-only
 * code.
 *
 * That makes `agents/ai-chat-agent` un-resolvable at unit-test time
 * and during the (unusual) flow where someone imports the plugin in a
 * Node-only context. So we wrap the import in a try/catch:
 *
 *  - **Production (consumer Worker):** `@cloudflare/ai-chat` is
 *    installed alongside `agents`; `await import('agents/ai-chat-agent')`
 *    returns the real `AIChatAgent`; `AgentChatDO extends AIChatAgent`
 *    behaves exactly as the SDK intends.
 *  - **Tests / Node:** the import throws `MODULE_NOT_FOUND`; we fall
 *    back to a structural stub class that exposes the same API surface
 *    we use (`messages`, `broadcast`, `onChatMessage`). The DO methods
 *    we test never reach the SDK internals, so the stub is enough.
 *
 * The resolution happens once at module load. Subsequent `extends`
 * see the resolved value — there's no per-instance branching.
 *
 * # Test stub limits
 *
 * The fallback is **not** a working chat agent — it has no DO storage,
 * no WebSocket lifecycle, no message persistence. It exists solely so
 * the class declaration `class AgentChatDO extends AIChatAgent {…}`
 * can be loaded outside workerd. Anything that actually wakes the DO
 * will of course need the real SDK in scope, which is the consumer
 * Worker's responsibility.
 */

import type {
  AIChatAgent as AIChatAgentReal,
  StreamTextOnFinishCallback,
  ToolSet,
  OnChatMessageOptions,
  UIMessage,
} from '@cloudflare/ai-chat';

// Re-export the types so the DO file pulls from one place.
export type { StreamTextOnFinishCallback, ToolSet, OnChatMessageOptions, UIMessage };

/**
 * Shape we extend. The plugin only uses `messages`, `broadcast`, and
 * the `onChatMessage` hook — narrowing here keeps the dependency
 * footprint small and makes the test stub feasible.
 */
export type AIChatAgentCtor<Env = unknown> = new (
  ...args: ConstructorParameters<
    typeof AIChatAgentReal<Env extends Cloudflare.Env ? Env : Cloudflare.Env>
  >
) => AIChatAgentReal<Env extends Cloudflare.Env ? Env : Cloudflare.Env>;

/**
 * Resolve `AIChatAgent` synchronously at module-load time. If the
 * optional peer is missing we fall back to a stub.
 *
 * Uses `require` via `createRequire` rather than ESM dynamic-import so
 * the resolution is synchronous — `class AgentChatDO extends Base` at
 * module top-level needs the value before the first await. In a
 * workerd build this resolves to the bundled `@cloudflare/ai-chat`
 * exactly the same way a static import would.
 */
function resolveAIChatAgent(): AIChatAgentCtor {
  try {
    // The string is dynamic so bundlers don't try to inline-resolve
    // it during static analysis (which would fail when the peer is
    // absent and break the build).
    const moduleId = 'agents/ai-chat-agent';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (globalThis as { require?: NodeRequire }).require?.(moduleId);
    if (mod && typeof mod.AIChatAgent === 'function') {
      return mod.AIChatAgent as AIChatAgentCtor;
    }
  } catch {
    // fall through to stub
  }
  return StubAIChatAgent as unknown as AIChatAgentCtor;
}

/**
 * Test/Node stub. Does the bare minimum the plugin's overrides expect:
 *  - exposes a mutable `messages` array
 *  - provides a no-op `broadcast` that subclasses can replace
 *  - declares `onChatMessage` so subclass overrides line up
 *
 * Constructed with no args — the real SDK signature is
 * `(ctx: AgentContext, env: Env)` but tests use `Object.create` to
 * bypass construction entirely.
 */
class StubAIChatAgent {
  messages: UIMessage[] = [];
  name = '';
  broadcast(_msg: string): void {
    // no-op
  }
  async onChatMessage(
    _onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: OnChatMessageOptions,
  ): Promise<Response | undefined> {
    return undefined;
  }
}

/**
 * The base class `AgentChatDO` extends. Callers should treat this as
 * `typeof AIChatAgentReal` — the type lies for ergonomics so subclass
 * overrides typecheck against the real class.
 */
export const AIChatAgent = resolveAIChatAgent();
